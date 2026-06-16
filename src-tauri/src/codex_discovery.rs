use std::{
    collections::hash_map::DefaultHasher,
    collections::{HashMap, HashSet},
    fs::{self, File},
    hash::{Hash, Hasher},
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        OnceLock,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use chrono::TimeZone;
use serde_json::{json, Value};

use crate::local_bridge;

const AGENT: &str = "codex";
const CLAUDE_AGENT: &str = "claude-code";
const DEFAULT_ACTIVE_MS: u64 = 5 * 60 * 60 * 1000;
const DISCOVERY_INTERVAL: Duration = Duration::from_secs(3);
const WATCH_INTERVAL: Duration = Duration::from_millis(500);
const MAX_ROLLOUTS_PER_SCAN: usize = 160;
const MAX_CLAUDE_DESKTOP_SESSIONS_PER_SCAN: usize = 30;
const CLAUDE_DESKTOP_INVENTORY_REPOST: Duration = Duration::from_secs(60);
const MAX_CLAUDE_LEVELDB_BYTES: u64 = 25 * 1024 * 1024;
const CLAUDE_LOG_INITIAL_TAIL_BYTES: u64 = 256 * 1024;
const MAX_LINE_CHARS: usize = 32 * 1024;
const SUMMARY_CHARS: usize = 90;
const DIGEST_ENTRY_LIMIT: usize = 8;
const DIGEST_ENTRY_CHARS: usize = 360;

static STARTED: AtomicBool = AtomicBool::new(false);
static LEARNING_SCRIPT: OnceLock<PathBuf> = OnceLock::new();

#[derive(Clone)]
struct SessionMeta {
    session_id: String,
    cwd: Option<String>,
    timestamp: Option<String>,
    path: PathBuf,
}

#[derive(Clone, Debug)]
struct ClaudeDesktopSession {
    session_id: String,
    desktop_session_id: Option<String>,
    surface: &'static str,
    title: String,
    cwd: Option<String>,
    initial_message: Option<String>,
    last_message_id: Option<String>,
    last_message_role: Option<String>,
    last_message_text: Option<String>,
    message_count: usize,
    timestamp_ms: u128,
}

#[derive(Default)]
struct ClaudeDesktopActivityState {
    log_offsets: HashMap<PathBuf, u64>,
    latest_log_events: HashMap<String, String>,
    session_index: HashMap<String, ClaudeDesktopSession>,
    chat_activity_signatures: HashMap<String, String>,
}

struct WatchedSession {
    path: PathBuf,
    offset: u64,
    cwd: Option<String>,
    last_event_key: Option<String>,
    latest_usage: Option<UsageSnapshot>,
    usage_baseline: Option<RawUsage>,
    digest_entries: Vec<DigestEntry>,
    last_learning_id: Option<String>,
    terminal_turn_ended: bool,
}

#[derive(Clone, Debug)]
struct DigestEntry {
    role: &'static str,
    text: String,
}

#[derive(Clone, Debug)]
struct RawUsage {
    input_tokens: u64,
    cached_input_tokens: u64,
    output_tokens: u64,
    reasoning_output_tokens: u64,
    total_tokens: u64,
}

#[derive(Clone, Debug)]
struct UsageSnapshot {
    total: RawUsage,
    last: Option<RawUsage>,
    model_context_window: Option<u64>,
}

pub fn start(learning_script: Option<PathBuf>) -> Result<(), String> {
    if let Some(path) = learning_script.filter(|path| path.is_file()) {
        let _ = LEARNING_SCRIPT.set(path);
    }

    if STARTED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(());
    }

    thread::Builder::new()
        .name("aivatar-codex-discovery".to_string())
        .spawn(discovery_loop)
        .map(|_| ())
        .map_err(|error| format!("Could not start Codex discovery: {error}"))
}

fn discovery_loop() {
    let mut watched = HashMap::<String, WatchedSession>::new();
    let mut claude_inventory_posts = HashMap::<String, (String, Instant)>::new();
    let mut claude_activity = ClaudeDesktopActivityState::default();
    let mut last_scan = Instant::now() - DISCOVERY_INTERVAL;

    loop {
        if last_scan.elapsed() >= DISCOVERY_INTERVAL {
            if let Some(root) = sessions_root() {
                for meta in discover_sessions(&root) {
                    refresh_presence(&meta);
                    watched
                        .entry(meta.session_id.clone())
                        .or_insert_with(|| initialize_watched_session(&meta));
                }
            }
            refresh_claude_desktop_inventory(&mut claude_inventory_posts, &mut claude_activity);
            tail_claude_desktop_activity_logs(&mut claude_activity);
            last_scan = Instant::now();
        }

        let stale_paths: HashSet<String> = watched
            .iter_mut()
            .filter_map(
                |(session_id, session)| match tail_session(session_id, session) {
                    Ok(()) => None,
                    Err(_) => Some(session_id.clone()),
                },
            )
            .collect();
        for session_id in stale_paths {
            watched.remove(&session_id);
        }

        thread::sleep(WATCH_INTERVAL);
    }
}

fn initialize_watched_session(meta: &SessionMeta) -> WatchedSession {
    let mut session = WatchedSession {
        offset: 0,
        path: meta.path.clone(),
        cwd: meta.cwd.clone(),
        last_event_key: None,
        usage_baseline: None,
        latest_usage: None,
        digest_entries: Vec::new(),
        last_learning_id: None,
        terminal_turn_ended: false,
    };
    let restored_status = restore_latest_status(&meta.session_id, &mut session);
    session.offset = file_len(&meta.path).unwrap_or(0);

    if let Some(status) = restored_status {
        session.last_event_key = Some(status_event_key(&status));
        submit_status(status);
    } else {
        let status = discovered_status(meta);
        session.last_event_key = Some(status_event_key(&status));
        submit_status(status);
    }

    session
}

fn sessions_root() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("CODEX_SESSIONS_ROOT").map(PathBuf::from) {
        return path.is_dir().then_some(path);
    }
    let codex_home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join(".codex")))
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex")))?;
    let root = codex_home.join("sessions");
    root.is_dir().then_some(root)
}

fn active_window() -> Duration {
    let millis = std::env::var("AIVATAR_DISCOVERY_ACTIVE_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_ACTIVE_MS);
    Duration::from_millis(millis)
}

fn discover_sessions(root: &Path) -> Vec<SessionMeta> {
    let mut files = Vec::<(SystemTime, PathBuf)>::new();
    collect_recent_jsonl(root, active_window(), &mut files);
    files.sort_by(|(left_time, _), (right_time, _)| right_time.cmp(left_time));

    files
        .into_iter()
        .take(MAX_ROLLOUTS_PER_SCAN)
        .filter_map(|(_, path)| read_session_meta(path))
        .collect()
}

fn refresh_claude_desktop_inventory(
    posted_cache: &mut HashMap<String, (String, Instant)>,
    activity: &mut ClaudeDesktopActivityState,
) {
    let sessions = discover_claude_desktop_inventory();
    let mut live_keys = HashSet::new();

    for session in sessions {
        remember_claude_desktop_session(activity, &session);
        let key = format!("{}:{}", session.surface, session.session_id);
        live_keys.insert(key.clone());
        let signature = format!(
            "{}:{}:{}:{}",
            session.timestamp_ms,
            session.title,
            session.cwd.as_deref().unwrap_or_default(),
            session.desktop_session_id.as_deref().unwrap_or_default()
        );
        if posted_cache
            .get(&key)
            .is_some_and(|(cached, posted_at)| {
                cached == &signature && posted_at.elapsed() < CLAUDE_DESKTOP_INVENTORY_REPOST
            })
        {
            continue;
        }
        submit_status(claude_desktop_inventory_status(&session));
        posted_cache.insert(key, (signature, Instant::now()));
    }

    posted_cache.retain(|key, _| live_keys.contains(key));
    post_claude_desktop_chat_activity(activity);
}

fn discover_claude_desktop_inventory() -> Vec<ClaudeDesktopSession> {
    let mut sessions = Vec::new();
    for root in claude_desktop_roots() {
        collect_claude_desktop_json_sessions(
            &root.join("claude-code-sessions"),
            "code",
            &mut sessions,
        );
        collect_claude_desktop_json_sessions(
            &root.join("local-agent-mode-sessions"),
            "cowork",
            &mut sessions,
        );
        collect_claude_desktop_chat_sessions(&root, &mut sessions);
    }

    let mut deduped = HashMap::<String, ClaudeDesktopSession>::new();
    for session in sessions {
        let key = format!("{}:{}", session.surface, session.session_id);
        if match deduped.get(&key) {
            Some(existing) => existing.timestamp_ms < session.timestamp_ms,
            None => true,
        } {
            deduped.insert(key, session);
        }
    }

    let mut sessions = deduped.into_values().collect::<Vec<_>>();
    sessions.sort_by(|left, right| right.timestamp_ms.cmp(&left.timestamp_ms));
    sessions.truncate(MAX_CLAUDE_DESKTOP_SESSIONS_PER_SCAN);
    sessions
}

fn claude_desktop_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(raw) = std::env::var_os("AIVATAR_CLAUDE_DESKTOP_ROOT") {
        roots.extend(std::env::split_paths(&raw));
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        roots.push(
            local_app_data
                .join("Packages")
                .join("Claude_pzs8sxrjxfjjc")
                .join("LocalCache")
                .join("Roaming")
                .join("Claude"),
        );
    }
    if let Some(app_data) = std::env::var_os("APPDATA").map(PathBuf::from) {
        roots.push(app_data.join("Claude"));
    }

    let mut seen = HashSet::new();
    roots
        .into_iter()
        .filter(|root| root.is_dir())
        .filter(|root| seen.insert(root.clone()))
        .collect()
}

fn collect_claude_desktop_json_sessions(
    root: &Path,
    surface: &'static str,
    sessions: &mut Vec<ClaudeDesktopSession>,
) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            collect_claude_desktop_json_sessions(&path, surface, sessions);
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with("local_") || !name.ends_with(".json") {
            continue;
        }
        if let Some(session) = read_claude_desktop_json_session(&path, surface) {
            sessions.push(session);
        }
    }
}

fn read_claude_desktop_json_session(
    path: &Path,
    surface: &'static str,
) -> Option<ClaudeDesktopSession> {
    let content = fs::read_to_string(path).ok()?;
    let parsed = serde_json::from_str::<Value>(&content).ok()?;
    let desktop_session_id = string_field(&parsed, "sessionId").or_else(|| string_field(&parsed, "id"));
    let session_id = string_field(&parsed, "cliSessionId").or_else(|| desktop_session_id.clone())?;
    let timestamp_ms = timestamp_ms_from_value(parsed.get("lastActivityAt"))
        .or_else(|| timestamp_ms_from_value(parsed.get("updatedAt")))
        .or_else(|| timestamp_ms_from_value(parsed.get("createdAt")))?;
    if !timestamp_in_active_window(timestamp_ms) {
        return None;
    }
    let fallback = if surface == "cowork" {
        "Cowork session"
    } else {
        "Code session"
    };
    Some(ClaudeDesktopSession {
        session_id,
        desktop_session_id,
        surface,
        title: normalize_inventory_title(
            string_field(&parsed, "title")
                .or_else(|| string_field(&parsed, "name"))
                .or_else(|| string_field(&parsed, "summary"))
                .as_deref(),
            fallback,
        ),
        cwd: string_field(&parsed, "cwd").or_else(|| string_field(&parsed, "originCwd")),
        initial_message: string_field(&parsed, "initialMessage")
            .map(|message| compact_text(&message, 140)),
        last_message_id: None,
        last_message_role: None,
        last_message_text: None,
        message_count: 0,
        timestamp_ms,
    })
}

fn collect_claude_desktop_chat_sessions(root: &Path, sessions: &mut Vec<ClaudeDesktopSession>) {
    let leveldb = root.join("Local Storage").join("leveldb");
    let mut conversations = HashMap::<String, ClaudeDesktopSession>::new();
    collect_claude_chat_leveldb_sessions(&leveldb, &mut conversations);
    sessions.extend(conversations.into_values());
}

fn collect_claude_chat_leveldb_sessions(
    root: &Path,
    conversations: &mut HashMap<String, ClaudeDesktopSession>,
) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            collect_claude_chat_leveldb_sessions(&path, conversations);
            continue;
        }
        let extension = path.extension().and_then(|value| value.to_str());
        if !matches!(extension, Some("log" | "ldb")) || metadata.len() > MAX_CLAUDE_LEVELDB_BYTES {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        let utf16 = decode_utf16le_lossy(&bytes);
        collect_claude_chat_objects(&utf16, conversations);
        if let Ok(utf8) = String::from_utf8(bytes) {
            collect_claude_chat_objects(&utf8, conversations);
        }
    }
}

fn collect_claude_chat_objects(
    text: &str,
    conversations: &mut HashMap<String, ClaudeDesktopSession>,
) {
    for marker in [
        "{\"uuid\":\"",
        "{\"state\":{\"data\":{\"uuid\":\"",
        "\"data\":{\"uuid\":\"",
    ] {
        collect_claude_chat_objects_for_marker(text, marker, conversations);
    }
}

fn collect_claude_chat_objects_for_marker(
    text: &str,
    marker: &str,
    conversations: &mut HashMap<String, ClaudeDesktopSession>,
) {
    let mut search_from = 0;
    while let Some(relative) = text[search_from..].find(marker) {
        let marker_start = search_from + relative;
        let bytes = text.as_bytes();
        let mut start = marker_start;
        while start > 0 && bytes[start] != b'{' {
            start -= 1;
        }
        let Some(end) = json_object_end(text, start) else {
            search_from = marker_start.saturating_add(marker.len());
            continue;
        };
        let raw = &text[start..end];
        if let Ok(parsed) = serde_json::from_str::<Value>(raw) {
            let conversation = parsed
                .get("state")
                .and_then(|state| state.get("data"))
                .or_else(|| parsed.get("data"))
                .unwrap_or(&parsed);
            if let Some(session) = claude_chat_session_from_value(conversation) {
                let key = session.session_id.clone();
                if match conversations.get(&key) {
                    Some(existing) => {
                        existing.timestamp_ms < session.timestamp_ms
                            || existing.message_count < session.message_count
                    }
                    None => true,
                } {
                    conversations.insert(key, session);
                }
            }
        }
        search_from = end;
    }
}

fn claude_chat_session_from_value(value: &Value) -> Option<ClaudeDesktopSession> {
    if string_field(value, "platform").is_some_and(|platform| platform != "CLAUDE_AI") {
        return None;
    }
    let session_id = string_field(value, "uuid")?;
    let title = string_field(value, "name")?;
    let timestamp_ms = timestamp_ms_from_value(value.get("updated_at"))
        .or_else(|| timestamp_ms_from_value(value.get("created_at")))?;
    if !timestamp_in_active_window(timestamp_ms) {
        return None;
    }
    let (last_message_id, last_message_role, last_message_text, message_count) =
        claude_chat_message_details(value);
    Some(ClaudeDesktopSession {
        session_id: session_id.clone(),
        desktop_session_id: Some(session_id),
        surface: "chat",
        title: normalize_inventory_title(Some(&title), "Chat session"),
        cwd: None,
        initial_message: None,
        last_message_id,
        last_message_role,
        last_message_text,
        message_count,
        timestamp_ms,
    })
}

fn claude_chat_message_details(
    value: &Value,
) -> (Option<String>, Option<String>, Option<String>, usize) {
    let Some(messages) = value
        .get("chat_messages")
        .or_else(|| value.get("chatMessages"))
        .or_else(|| value.get("messages"))
        .and_then(Value::as_array)
    else {
        return (
            string_field(value, "current_leaf_message_uuid")
                .or_else(|| string_field(value, "currentLeafMessageUuid")),
            None,
            None,
            0,
        );
    };
    let leaf_id = string_field(value, "current_leaf_message_uuid")
        .or_else(|| string_field(value, "currentLeafMessageUuid"));
    let message = leaf_id
        .as_ref()
        .and_then(|id| {
            messages
                .iter()
                .find(|entry| string_field(entry, "uuid").as_deref() == Some(id.as_str()))
        })
        .or_else(|| messages.last());
    let Some(message) = message else {
        return (leaf_id, None, None, messages.len());
    };
    let message_id = string_field(message, "uuid").or_else(|| string_field(message, "id")).or(leaf_id);
    let role = string_field(message, "sender")
        .or_else(|| string_field(message, "type"))
        .or_else(|| string_field(message, "role"))
        .or_else(|| message.get("message").and_then(|value| string_field(value, "role")));
    let text = compact_text(&flatten_text(message), 180);
    (
        message_id,
        role,
        (!text.is_empty()).then_some(text),
        messages.len(),
    )
}

fn json_object_end(text: &str, start: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut depth = 0_i32;
    let mut in_string = false;
    let mut escape = false;
    for (offset, byte) in bytes[start..].iter().enumerate() {
        if escape {
            escape = false;
            continue;
        }
        if *byte == b'\\' {
            escape = true;
            continue;
        }
        if *byte == b'"' {
            in_string = !in_string;
            continue;
        }
        if in_string {
            continue;
        }
        if *byte == b'{' {
            depth += 1;
        } else if *byte == b'}' {
            depth -= 1;
            if depth == 0 {
                return Some(start + offset + 1);
            }
        }
    }
    None
}

fn decode_utf16le_lossy(bytes: &[u8]) -> String {
    let units = bytes
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect::<Vec<_>>();
    String::from_utf16_lossy(&units)
}

fn timestamp_ms_from_value(value: Option<&Value>) -> Option<u128> {
    match value? {
        Value::Number(number) => number
            .as_u64()
            .map(|value| if value > 10_000_000_000 { value } else { value * 1000 })
            .map(u128::from),
        Value::String(text) => {
            let clean = text.trim();
            if clean.is_empty() {
                return None;
            }
            if let Ok(value) = clean.parse::<u64>() {
                return Some(if value > 10_000_000_000 {
                    u128::from(value)
                } else {
                    u128::from(value * 1000)
                });
            }
            chrono::DateTime::parse_from_rfc3339(clean)
                .ok()
                .and_then(|date| u128::try_from(date.timestamp_millis()).ok())
        }
        _ => None,
    }
}

fn unix_now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn timestamp_in_active_window(timestamp_ms: u128) -> bool {
    if timestamp_ms == 0 {
        return false;
    }
    let now = unix_now_ms();
    if timestamp_ms > now.saturating_add(60_000) {
        return true;
    }
    now.saturating_sub(timestamp_ms) <= active_window().as_millis()
}

fn activity_window() -> Duration {
    let default_ms = active_window().as_millis().min(30 * 60 * 1000);
    let millis = std::env::var("AIVATAR_CLAUDE_DESKTOP_ACTIVITY_WINDOW_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .map(u128::from)
        .unwrap_or(default_ms);
    Duration::from_millis(u64::try_from(millis).unwrap_or(u64::MAX))
}

fn timestamp_in_activity_window(timestamp_ms: u128) -> bool {
    if timestamp_ms == 0 {
        return false;
    }
    let now = unix_now_ms();
    if timestamp_ms > now.saturating_add(60_000) {
        return true;
    }
    now.saturating_sub(timestamp_ms) <= activity_window().as_millis()
}

fn claude_log_timestamp_ms(line: &str) -> Option<u128> {
    let prefix = line.get(0..19)?;
    let naive = chrono::NaiveDateTime::parse_from_str(prefix, "%Y-%m-%d %H:%M:%S").ok()?;
    chrono::Local
        .from_local_datetime(&naive)
        .single()
        .or_else(|| chrono::Local.from_local_datetime(&naive).earliest())
        .and_then(|date| u128::try_from(date.timestamp_millis()).ok())
}

fn iso_from_timestamp_ms(timestamp_ms: u128) -> String {
    chrono::DateTime::from_timestamp_millis(i64::try_from(timestamp_ms).unwrap_or(i64::MAX))
        .map(|date| date.to_rfc3339())
        .unwrap_or_else(iso_now)
}

fn expires_from_timestamp_ms(timestamp_ms: u128) -> String {
    iso_from_timestamp_ms(timestamp_ms.saturating_add(active_window().as_millis()))
}

fn normalize_inventory_title(value: Option<&str>, fallback: &str) -> String {
    let clean = value
        .unwrap_or(fallback)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if clean.is_empty() {
        fallback.to_string()
    } else {
        clean
    }
}

fn compact_text(value: &str, limit: usize) -> String {
    let clean = value.split_whitespace().collect::<Vec<_>>().join(" ");
    clean.chars().take(limit).collect()
}

fn flatten_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(flatten_text)
            .filter(|text| !text.trim().is_empty())
            .collect::<Vec<_>>()
            .join(" "),
        Value::Object(object) => {
            for key in ["text", "delta", "value", "content"] {
                if let Some(value) = object.get(key) {
                    let text = flatten_text(value);
                    if !text.trim().is_empty() {
                        return text;
                    }
                }
            }
            if let Some(message) = object.get("message") {
                flatten_text(message)
            } else {
                String::new()
            }
        }
        _ => String::new(),
    }
}

fn extract_after<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    text.split(prefix).nth(1)
}

fn claude_desktop_inventory_status(session: &ClaudeDesktopSession) -> Value {
    let label = match session.surface {
        "chat" => "Claude Chat",
        "cowork" => "Claude Cowork",
        _ => "Claude Code",
    };
    let timestamp = iso_from_timestamp_ms(session.timestamp_ms);
    let mut value = json!({
        "agent": CLAUDE_AGENT,
        "sessionId": session.session_id,
        "status": "idle",
        "phase": format!("desktop-{}-session", session.surface),
        "task": format!("{label} session discovered"),
        "summary": format!("{label}: {}", session.title),
        "progress": 0,
        "message": session.title,
        "severity": "info",
        "timestamp": timestamp,
        "presenceTimestamp": timestamp,
        "expiresAt": expires_from_timestamp_ms(session.timestamp_ms),
        "source": "claude-desktop-inventory",
        "surface": session.surface,
    });
    if let Some(object) = value.as_object_mut() {
        if let Some(cwd) = &session.cwd {
            object.insert("detail".to_string(), json!(cwd));
        }
        if let Some(desktop_session_id) = &session.desktop_session_id {
            object.insert("desktopSessionId".to_string(), json!(desktop_session_id));
        }
    }
    value
}

fn remember_claude_desktop_session(
    activity: &mut ClaudeDesktopActivityState,
    session: &ClaudeDesktopSession,
) {
    activity
        .session_index
        .insert(session.session_id.clone(), session.clone());
    if let Some(desktop_session_id) = &session.desktop_session_id {
        activity
            .session_index
            .insert(desktop_session_id.clone(), session.clone());
    }
}

fn resolve_claude_desktop_session(
    activity: &mut ClaudeDesktopActivityState,
    desktop_session_id: &str,
    cli_session_id: Option<&str>,
) -> ClaudeDesktopSession {
    let mut session = activity
        .session_index
        .get(desktop_session_id)
        .cloned()
        .or_else(|| cli_session_id.and_then(|id| activity.session_index.get(id).cloned()))
        .unwrap_or_else(|| ClaudeDesktopSession {
            session_id: cli_session_id.unwrap_or(desktop_session_id).to_string(),
            desktop_session_id: Some(desktop_session_id.to_string()),
            surface: "code",
            title: "Session".to_string(),
            cwd: None,
            initial_message: None,
            last_message_id: None,
            last_message_role: None,
            last_message_text: None,
            message_count: 0,
            timestamp_ms: unix_now_ms(),
        });
    if let Some(cli_session_id) = cli_session_id {
        session.session_id = cli_session_id.to_string();
    }
    session.desktop_session_id = Some(desktop_session_id.to_string());
    remember_claude_desktop_session(activity, &session);
    session
}

fn claude_desktop_session_label(session: &ClaudeDesktopSession) -> &'static str {
    match session.surface {
        "chat" => "Claude Chat",
        "cowork" => "Claude Cowork",
        _ => "Claude Code",
    }
}

fn claude_desktop_activity_status(
    session: &ClaudeDesktopSession,
    status: &str,
    phase: &str,
    message: &str,
    timestamp_ms: u128,
) -> Value {
    let label = claude_desktop_session_label(session);
    let timestamp = iso_from_timestamp_ms(timestamp_ms);
    let subject = if session.title.is_empty() {
        session.initial_message.as_deref().unwrap_or_default()
    } else {
        &session.title
    };
    let summary = if subject.is_empty() {
        label.to_string()
    } else {
        format!("{label}: {subject}")
    };
    let mut value = json!({
        "agent": CLAUDE_AGENT,
        "sessionId": session.session_id,
        "status": status,
        "phase": phase,
        "task": format!("{label} activity"),
        "summary": summary,
        "progress": if status == "complete" || status == "error" { 100 } else { 55 },
        "message": message,
        "severity": if status == "error" { "error" } else { "info" },
        "timestamp": timestamp,
        "presenceTimestamp": timestamp,
        "expiresAt": expires_from_timestamp_ms(timestamp_ms),
        "source": "claude-desktop-activity",
        "surface": session.surface,
    });
    if let Some(object) = value.as_object_mut() {
        if let Some(cwd) = &session.cwd {
            object.insert("detail".to_string(), json!(cwd));
        }
        if let Some(desktop_session_id) = &session.desktop_session_id {
            object.insert("desktopSessionId".to_string(), json!(desktop_session_id));
        }
    }
    value
}

fn post_claude_desktop_chat_activity(activity: &mut ClaudeDesktopActivityState) {
    let sessions = activity
        .session_index
        .values()
        .filter(|session| session.surface == "chat" && timestamp_in_activity_window(session.timestamp_ms))
        .cloned()
        .collect::<Vec<_>>();
    for session in sessions {
        let signature = format!(
            "{}:{}:{}:{}:{}",
            session.timestamp_ms,
            session.last_message_id.as_deref().unwrap_or_default(),
            session.last_message_role.as_deref().unwrap_or_default(),
            session.last_message_text.as_deref().unwrap_or_default(),
            session.message_count
        );
        if activity
            .chat_activity_signatures
            .get(&session.session_id)
            .is_some_and(|cached| cached == &signature)
        {
            continue;
        }
        activity
            .chat_activity_signatures
            .insert(session.session_id.clone(), signature);
        let role = session
            .last_message_role
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase();
        let user_like = role.contains("human") || role.contains("user");
        let text = session
            .last_message_text
            .as_deref()
            .filter(|text| !text.trim().is_empty())
            .unwrap_or(&session.title);
        let message = if user_like {
            format!("Claude Chat is thinking: {text}")
        } else {
            text.to_string()
        };
        let phase = if user_like {
            "desktop-chat-user-message"
        } else {
            "desktop-chat-complete"
        };
        submit_status(claude_desktop_activity_status(
            &session,
            if user_like { "thinking" } else { "complete" },
            phase,
            &message,
            session.timestamp_ms,
        ));
    }
}

fn tail_claude_desktop_activity_logs(activity: &mut ClaudeDesktopActivityState) {
    for root in claude_desktop_roots() {
        let path = root.join("logs").join("main.log");
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        let mut offset = activity
            .log_offsets
            .get(&path)
            .copied()
            .unwrap_or_else(|| metadata.len().saturating_sub(CLAUDE_LOG_INITIAL_TAIL_BYTES));
        if metadata.len() < offset {
            offset = 0;
        }
        if metadata.len() == offset {
            continue;
        }
        let Ok(mut file) = File::open(&path) else {
            continue;
        };
        if file.seek(SeekFrom::Start(offset)).is_err() {
            continue;
        }
        let mut appended = String::new();
        if file.read_to_string(&mut appended).is_err() {
            continue;
        }
        activity.log_offsets.insert(path, metadata.len());
        for line in appended.lines().filter(|line| !line.trim().is_empty()) {
            if let Some(status) = claude_desktop_activity_status_from_log_line(activity, line) {
                let event_key = status_event_key(&status);
                let session_id = string_field(&status, "sessionId").unwrap_or_default();
                if activity
                    .latest_log_events
                    .get(&session_id)
                    .is_some_and(|cached| cached == &event_key)
                {
                    continue;
                }
                activity.latest_log_events.insert(session_id, event_key);
                submit_status(status);
            }
        }
    }
}

fn claude_desktop_activity_status_from_log_line(
    activity: &mut ClaudeDesktopActivityState,
    line: &str,
) -> Option<Value> {
    let timestamp_ms = claude_log_timestamp_ms(line).unwrap_or_else(unix_now_ms);
    if !timestamp_in_activity_window(timestamp_ms) {
        return None;
    }

    if let Some(rest) = line.split("Mapping internal session ").nth(1) {
        if let Some((desktop_session_id, cli_session_id)) = rest.split_once(" to CLI session ") {
            let desktop_session_id = desktop_session_id.split_whitespace().next()?.trim();
            let cli_session_id = cli_session_id.split_whitespace().next()?.trim();
            resolve_claude_desktop_session(activity, desktop_session_id, Some(cli_session_id));
        }
        return None;
    }

    if line.contains("[Lifecycle] Session ")
        && (line.contains("→ running") || line.contains("-> running"))
    {
        let desktop_session_id = extract_after(line, "[Lifecycle] Session ")?
            .split(':')
            .next()?
            .trim();
        let session = resolve_claude_desktop_session(activity, desktop_session_id, None);
        let label = claude_desktop_session_label(&session);
        let subject = if session.title.is_empty() {
            session.initial_message.as_deref().unwrap_or_default()
        } else {
            &session.title
        };
        let message = if subject.is_empty() {
            format!("{label} is running")
        } else {
            format!("{label} is running: {subject}")
        };
        return Some(claude_desktop_activity_status(
            &session,
            "executing",
            &format!("desktop-{}-running", session.surface),
            &message,
            timestamp_ms,
        ));
    }

    if let Some(desktop_session_id) = extract_after(line, "[Result] Turn succeeded for session ") {
        let desktop_session_id = desktop_session_id.split_whitespace().next()?.trim();
        let session = resolve_claude_desktop_session(activity, desktop_session_id, None);
        return Some(claude_desktop_activity_status(
            &session,
            "complete",
            &format!("desktop-{}-complete", session.surface),
            &format!("{} turn complete", claude_desktop_session_label(&session)),
            timestamp_ms,
        ));
    }

    if let Some(desktop_session_id) = extract_after(line, "[Stop hook] Query completed for session ") {
        let desktop_session_id = desktop_session_id.split_whitespace().next()?.trim();
        let session = resolve_claude_desktop_session(activity, desktop_session_id, None);
        return Some(claude_desktop_activity_status(
            &session,
            "complete",
            &format!("desktop-{}-complete", session.surface),
            &format!("{} turn complete", claude_desktop_session_label(&session)),
            timestamp_ms,
        ));
    }

    if line.contains("Turn failed") || line.contains("StopFailure") {
        if let Some(desktop_session_id) = line.split("session ").nth(1) {
            let desktop_session_id = desktop_session_id.split_whitespace().next()?.trim();
            let session = resolve_claude_desktop_session(activity, desktop_session_id, None);
            return Some(claude_desktop_activity_status(
                &session,
                "error",
                &format!("desktop-{}-error", session.surface),
                &format!("{} turn failed", claude_desktop_session_label(&session)),
                timestamp_ms,
            ));
        }
    }

    None
}

fn collect_recent_jsonl(root: &Path, max_age: Duration, files: &mut Vec<(SystemTime, PathBuf)>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            collect_recent_jsonl(&path, max_age, files);
            continue;
        }
        if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
            continue;
        }
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        if modified
            .elapsed()
            .map(|elapsed| elapsed <= max_age)
            .unwrap_or(false)
        {
            files.push((modified, path));
        }
    }
}

fn read_session_meta(path: PathBuf) -> Option<SessionMeta> {
    let file = File::open(&path).ok()?;
    let reader = BufReader::new(file);
    for line in reader.lines().take(20).flatten() {
        let record = serde_json::from_str::<Value>(&line).ok()?;
        if record.get("type").and_then(Value::as_str) != Some("session_meta") {
            continue;
        }
        let payload = record.get("payload").unwrap_or(&record);
        let session_id = string_field(payload, "id")
            .or_else(|| string_field(payload, "session_id"))
            .or_else(|| string_field(payload, "sessionId"))?;
        return Some(SessionMeta {
            cwd: string_field(payload, "cwd")
                .or_else(|| string_field(payload, "initial_cwd"))
                .or_else(|| string_field(payload, "workspace")),
            timestamp: string_field(payload, "timestamp")
                .or_else(|| string_field(&record, "timestamp")),
            session_id,
            path,
        });
    }
    None
}

fn refresh_presence(meta: &SessionMeta) {
    let timestamp = meta.timestamp.clone().unwrap_or_else(iso_now);
    let _ = local_bridge::submit_presence(json!({
        "agent": AGENT,
        "sessionId": meta.session_id,
        "timestamp": timestamp
    }));
}

fn discovered_status(meta: &SessionMeta) -> Value {
    let summary = meta
        .cwd
        .as_ref()
        .map(|cwd| format!("Detected Codex session in {cwd}"))
        .unwrap_or_else(|| "Detected Codex Desktop session".to_string());
    json!({
        "agent": AGENT,
        "sessionId": meta.session_id,
        "status": "thinking",
        "phase": "discovered",
        "task": "Codex Desktop session detected",
        "summary": summary,
        "progress": 20,
        "message": "Codex Desktop session detected",
        "severity": "info",
        "timestamp": iso_now()
    })
}

fn tail_session(session_id: &str, session: &mut WatchedSession) -> Result<(), String> {
    let current_len = file_len(&session.path)?;
    if current_len < session.offset {
        session.offset = current_len;
        return Ok(());
    }
    if current_len == session.offset {
        return Ok(());
    }

    let mut file = File::open(&session.path).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(session.offset))
        .map_err(|error| error.to_string())?;
    let mut appended = String::new();
    file.read_to_string(&mut appended)
        .map_err(|error| error.to_string())?;
    session.offset = current_len;

    for line in appended.lines().filter(|line| !line.trim().is_empty()) {
        if line.len() > MAX_LINE_CHARS {
            continue;
        }
        if let Ok(record) = serde_json::from_str::<Value>(line) {
            handle_record(session_id, session, &record);
        }
    }
    Ok(())
}

fn handle_record(session_id: &str, session: &mut WatchedSession, record: &Value) {
    let status = status_from_record(session_id, session, record, true);

    if let Some(status) = status {
        let event_key = status_event_key(&status);
        if session.last_event_key.as_deref() == Some(event_key.as_str()) {
            return;
        }
        session.last_event_key = Some(event_key);
        submit_status(status);
    }
}

fn restore_latest_status(session_id: &str, session: &mut WatchedSession) -> Option<Value> {
    let file = File::open(&session.path).ok()?;
    let reader = BufReader::new(file);
    let mut latest_status = None;
    for line in reader.lines().map_while(Result::ok) {
        if line.len() > MAX_LINE_CHARS || line.trim().is_empty() {
            continue;
        }
        let Ok(record) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(status) = status_from_record(session_id, session, &record, false) {
            latest_status = Some(status);
        }
    }
    latest_status
}

fn status_from_record(
    session_id: &str,
    session: &mut WatchedSession,
    record: &Value,
    allow_learning_worker: bool,
) -> Option<Value> {
    let record_type = record.get("type").and_then(Value::as_str);
    let payload = record.get("payload").unwrap_or(record);
    let payload_type = payload.get("type").and_then(Value::as_str);
    let phase = payload
        .get("phase")
        .and_then(Value::as_str)
        .unwrap_or_default();

    match (record_type, payload_type, phase) {
        (Some("event_msg"), Some("token_count"), _) => {
            if let Some(snapshot) = usage_snapshot_from_record(record) {
                session.latest_usage = Some(snapshot.clone());
                if session.terminal_turn_ended {
                    return None;
                }
                let usage = context_usage(&snapshot);
                Some(build_status(
                    session_id,
                    "thinking",
                    "context-window",
                    "Updating Codex context usage".to_string(),
                    45,
                    &session.cwd,
                    usage,
                    None,
                    event_timestamp(record),
                ))
            } else {
                None
            }
        }
        (Some("event_msg"), Some("user_message"), _) => {
            session.terminal_turn_ended = false;
            session.usage_baseline = session
                .latest_usage
                .as_ref()
                .map(|usage| usage.total.clone());
            if let Some(text) = text_from_payload(payload) {
                remember_digest(session, "user", &text);
            }
            Some(build_status(
                session_id,
                "thinking",
                "user-message",
                text_from_payload(payload).unwrap_or_else(|| "Reading user request".to_string()),
                30,
                &session.cwd,
                None,
                None,
                event_timestamp(record),
            ))
        }
        (Some("response_item"), Some("function_call" | "custom_tool_call"), _) => {
            session.terminal_turn_ended = false;
            if session.usage_baseline.is_none() {
                session.usage_baseline = session
                    .latest_usage
                    .as_ref()
                    .map(|usage| usage.total.clone());
            }
            let tool_name = string_field(payload, "name")
                .or_else(|| string_field(payload, "tool_name"))
                .unwrap_or_else(|| "tool".to_string());
            Some(build_status(
                session_id,
                "executing",
                "tool-use",
                format!("Using {tool_name}"),
                55,
                &session.cwd,
                None,
                None,
                event_timestamp(record),
            ))
        }
        (Some("response_item"), Some("function_call_output" | "custom_tool_call_output"), _) => {
            session.terminal_turn_ended = false;
            if session.usage_baseline.is_none() {
                session.usage_baseline = session
                    .latest_usage
                    .as_ref()
                    .map(|usage| usage.total.clone());
            }
            Some(build_status(
                session_id,
                "thinking",
                "tool-result",
                "Reviewing tool result".to_string(),
                65,
                &session.cwd,
                None,
                None,
                event_timestamp(record),
            ))
        }
        (Some("event_msg"), Some("agent_message"), "final" | "final_answer") => {
            let final_text =
                text_from_payload(payload).unwrap_or_else(|| "Task finished".to_string());
            remember_digest(session, "assistant", &final_text);
            let usage = completion_usage(session);
            let worker_started = allow_learning_worker
                && spawn_learning_worker(session_id, "complete", &final_text, session);
            let learning = if worker_started {
                None
            } else {
                heuristic_learning(session_id, phase, &final_text, session)
            };
            session.usage_baseline = None;
            session.digest_entries.clear();
            session.terminal_turn_ended = true;
            Some(build_status(
                session_id,
                "complete",
                phase,
                final_text,
                100,
                &session.cwd,
                usage,
                learning,
                event_timestamp(record),
            ))
        }
        _ => None,
    }
}

fn build_status(
    session_id: &str,
    status: &str,
    phase: &str,
    message: String,
    progress: u8,
    cwd: &Option<String>,
    usage: Option<Value>,
    learning: Option<Value>,
    timestamp: String,
) -> Value {
    let summary = summarize(&message);
    let mut payload = json!({
        "agent": AGENT,
        "sessionId": session_id,
        "status": status,
        "phase": phase,
        "task": summary,
        "summary": summary,
        "progress": progress,
        "message": summary,
        "severity": "info",
        "timestamp": timestamp
    });
    if let Some(cwd) = cwd {
        if let Some(object) = payload.as_object_mut() {
            object.insert(
                "detail".to_string(),
                json!(format!("Codex session in {cwd}")),
            );
        }
    }
    if let Some(usage) = usage {
        if let Some(object) = payload.as_object_mut() {
            object.insert("usage".to_string(), usage);
        }
    }
    if let Some(learning) = learning {
        if let Some(object) = payload.as_object_mut() {
            object.insert("learning".to_string(), learning);
        }
    }
    payload
}

fn usage_snapshot_from_record(record: &Value) -> Option<UsageSnapshot> {
    let payload = record.get("payload")?;
    if payload.get("type").and_then(Value::as_str) != Some("token_count") {
        return None;
    }
    let info = payload.get("info")?;
    let total = raw_usage(info.get("total_token_usage")?)?;
    let last = info.get("last_token_usage").and_then(raw_usage);
    let model_context_window = number_field(info, "model_context_window");
    Some(UsageSnapshot {
        total,
        last,
        model_context_window,
    })
}

fn raw_usage(value: &Value) -> Option<RawUsage> {
    let total_tokens = number_field(value, "total_tokens")?;
    Some(RawUsage {
        input_tokens: number_field(value, "input_tokens").unwrap_or(0),
        cached_input_tokens: number_field(value, "cached_input_tokens").unwrap_or(0),
        output_tokens: number_field(value, "output_tokens").unwrap_or(0),
        reasoning_output_tokens: number_field(value, "reasoning_output_tokens").unwrap_or(0),
        total_tokens,
    })
}

fn completion_usage(session: &WatchedSession) -> Option<Value> {
    let latest = session.latest_usage.as_ref()?;
    let (usage, scope) = if let Some(baseline) = &session.usage_baseline {
        (subtract_usage(&latest.total, baseline), "since-baseline")
    } else if let Some(last) = &latest.last {
        (last.clone(), "last-turn")
    } else {
        return None;
    };
    (usage.total_tokens > 0).then(|| {
        usage_to_aivatar(
            &usage,
            scope,
            latest.last.as_ref(),
            latest.model_context_window,
        )
    })
}

fn context_usage(snapshot: &UsageSnapshot) -> Option<Value> {
    let last = snapshot.last.as_ref()?;
    let model_context_window = snapshot.model_context_window?;
    (last.total_tokens > 0 && model_context_window > 0).then(|| {
        usage_to_aivatar(
            last,
            "context-window",
            Some(last),
            Some(model_context_window),
        )
    })
}

fn subtract_usage(current: &RawUsage, baseline: &RawUsage) -> RawUsage {
    RawUsage {
        input_tokens: current.input_tokens.saturating_sub(baseline.input_tokens),
        cached_input_tokens: current
            .cached_input_tokens
            .saturating_sub(baseline.cached_input_tokens),
        output_tokens: current.output_tokens.saturating_sub(baseline.output_tokens),
        reasoning_output_tokens: current
            .reasoning_output_tokens
            .saturating_sub(baseline.reasoning_output_tokens),
        total_tokens: current.total_tokens.saturating_sub(baseline.total_tokens),
    }
}

fn usage_to_aivatar(
    usage: &RawUsage,
    scope: &str,
    context: Option<&RawUsage>,
    model_context_window: Option<u64>,
) -> Value {
    let mut value = json!({
        "inputTokens": usage.input_tokens,
        "cachedInputTokens": usage.cached_input_tokens,
        "outputTokens": usage.output_tokens,
        "reasoningOutputTokens": usage.reasoning_output_tokens,
        "totalTokens": usage.total_tokens,
        "source": "codex-desktop-jsonl",
        "scope": scope
    });
    if let (Some(context), Some(model_context_window)) = (context, model_context_window) {
        if context.total_tokens > 0 && model_context_window > 0 {
            if let Some(object) = value.as_object_mut() {
                object.insert("contextTokens".to_string(), json!(context.total_tokens));
                object.insert(
                    "modelContextWindow".to_string(),
                    json!(model_context_window),
                );
            }
        }
    }
    value
}

fn remember_digest(session: &mut WatchedSession, role: &'static str, text: &str) {
    let clean = sanitize_learning_text(text, DIGEST_ENTRY_CHARS);
    if clean.is_empty() {
        return;
    }
    session
        .digest_entries
        .push(DigestEntry { role, text: clean });
    if session.digest_entries.len() > DIGEST_ENTRY_LIMIT {
        let overflow = session.digest_entries.len() - DIGEST_ENTRY_LIMIT;
        session.digest_entries.drain(0..overflow);
    }
}

fn learning_context_dir() -> PathBuf {
    std::env::temp_dir().join("aivatar-learning-context")
}

fn avatar_state_file() -> PathBuf {
    std::env::var_os("AIVATAR_AVATAR_STATE_FILE")
        .or_else(|| std::env::var_os("AIVATAR_AVATAR_STATE_PATH"))
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("aivatar-avatar-state.json"))
}

fn safe_file_component(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn learning_digest(session: &WatchedSession) -> Option<String> {
    if session.digest_entries.is_empty() {
        return None;
    }

    let digest = session
        .digest_entries
        .iter()
        .map(|entry| format!("{}: {}", entry.role, entry.text))
        .collect::<Vec<_>>()
        .join("\n");
    (!digest.trim().is_empty()).then_some(digest)
}

fn write_learning_context(session_id: &str, session: &WatchedSession) -> Option<PathBuf> {
    let digest = learning_digest(session)?;
    let dir = learning_context_dir();
    std::fs::create_dir_all(&dir).ok()?;
    let millis = chrono::Utc::now().timestamp_millis();
    let path = dir.join(format!(
        "codex-{}-{millis}.txt",
        safe_file_component(session_id)
    ));
    std::fs::write(&path, digest).ok()?;
    Some(path)
}

fn command_variants(command: &str) -> Vec<String> {
    if cfg!(target_os = "windows") && Path::new(command).extension().is_none() {
        vec![
            command.to_string(),
            format!("{command}.cmd"),
            format!("{command}.exe"),
            format!("{command}.bat"),
        ]
    } else {
        vec![command.to_string()]
    }
}

fn resolve_command(command: &str) -> Option<PathBuf> {
    let command_path = PathBuf::from(command);
    if command_path.components().count() > 1 && command_path.is_file() {
        return Some(command_path);
    }

    let lookup = if cfg!(target_os = "windows") {
        ("where.exe", vec![command.to_string()])
    } else {
        ("which", vec![command.to_string()])
    };

    let mut process = Command::new(lookup.0);
    process
        .args(lookup.1)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        process.creation_flags(0x08000000);
    }

    if let Ok(output) = process.output() {
        if output.status.success() {
            if let Some(path) = String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(PathBuf::from)
                .find(|path| path.is_file())
            {
                return Some(path);
            }
        }
    }

    let mut search_dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();

    if !cfg!(target_os = "windows") {
        search_dirs.extend([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
            PathBuf::from("/usr/sbin"),
            PathBuf::from("/sbin"),
        ]);
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            search_dirs.push(home.join(".local").join("bin"));
            search_dirs.push(home.join(".cargo").join("bin"));
        }
    }

    let variants = command_variants(command);
    search_dirs
        .into_iter()
        .flat_map(|dir| variants.iter().map(move |variant| dir.join(variant)))
        .find(|path| path.is_file())
}

fn spawn_learning_worker(
    session_id: &str,
    status: &str,
    summary: &str,
    session: &WatchedSession,
) -> bool {
    let Some(node_command) = resolve_command("node") else {
        return false;
    };
    let provider =
        std::env::var("AIVATAR_LEARNING_PROVIDER").unwrap_or_else(|_| "codex".to_string());
    let provider_command = match provider.as_str() {
        "codex" => resolve_command("codex").or_else(|| resolve_command("codex.cmd")),
        "claude-code" => resolve_command("claude"),
        "none" => return false,
        _ => return false,
    };
    let Some(provider_command) = provider_command else {
        return false;
    };
    let Some(script) = LEARNING_SCRIPT.get().filter(|path| path.is_file()) else {
        return false;
    };
    let Some(context_path) = write_learning_context(session_id, session) else {
        return false;
    };

    let mut command = Command::new(node_command);
    command
        .arg(script)
        .arg("--provider")
        .arg(&provider)
        .arg("--agent")
        .arg(AGENT)
        .arg("--session")
        .arg(session_id)
        .arg("--status")
        .arg(status)
        .arg("--summary")
        .arg(summarize(summary))
        .arg("--context-file")
        .arg(context_path)
        .arg("--avatar-state-file")
        .arg(avatar_state_file())
        .env(
            match provider.as_str() {
                "claude-code" => "AIVATAR_CLAUDE_COMMAND",
                _ => "AIVATAR_CODEX_COMMAND",
            },
            provider_command,
        )
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    command.spawn().is_ok()
}

fn heuristic_learning(
    session_id: &str,
    phase: &str,
    final_text: &str,
    session: &mut WatchedSession,
) -> Option<Value> {
    if session.digest_entries.is_empty() {
        return None;
    }
    let digest = session
        .digest_entries
        .iter()
        .map(|entry| format!("{}: {}", entry.role, entry.text))
        .collect::<Vec<_>>()
        .join(" ");
    let summary = learning_summary(&digest, final_text);
    let id = learning_id(session_id, phase, &summary, &digest);
    if session.last_learning_id.as_deref() == Some(id.as_str()) {
        return None;
    }
    session.last_learning_id = Some(id.clone());
    let language = if has_han_text(&digest) || has_han_text(final_text) {
        "zh"
    } else {
        "en"
    };
    let trait_changes = learning_trait_changes(&digest, final_text);
    let bubbles = idle_bubble_candidates(&digest, language);
    Some(json!({
        "id": id,
        "source": "heuristic",
        "summary": summary,
        "idleBubbleCandidates": bubbles,
        "traitChanges": trait_changes,
        "xp": 2,
        "confidence": 0.35,
        "privacyRisk": "low"
    }))
}

fn sanitize_learning_text(text: &str, limit: usize) -> String {
    let without_code_blocks = replace_between(text, "```", " ");
    let without_inline_code = replace_between(&without_code_blocks, "`", " ");
    let mut words = Vec::new();
    for word in without_inline_code.split_whitespace() {
        let lower = word.to_ascii_lowercase();
        let clean = if lower.starts_with("http://") || lower.starts_with("https://") {
            "[url]"
        } else if word.contains('@') && word.contains('.') {
            "[email]"
        } else if lower.contains("token=")
            || lower.contains("token:")
            || lower.contains("secret=")
            || lower.contains("secret:")
            || lower.contains("password=")
            || lower.contains("password:")
            || lower.contains("api_key")
            || lower.contains("apikey")
        {
            "[secret]"
        } else if looks_like_path(word) {
            "[path]"
        } else {
            word
        };
        words.push(clean);
    }
    summarize_to_chars(&words.join(" "), limit)
}

fn replace_between(text: &str, delimiter: &str, replacement: &str) -> String {
    let mut output = String::new();
    let mut rest = text;
    loop {
        let Some(start) = rest.find(delimiter) else {
            output.push_str(rest);
            break;
        };
        output.push_str(&rest[..start]);
        output.push_str(replacement);
        rest = &rest[start + delimiter.len()..];
        let Some(end) = rest.find(delimiter) else {
            break;
        };
        rest = &rest[end + delimiter.len()..];
    }
    output
}

fn looks_like_path(word: &str) -> bool {
    let trimmed = word.trim_matches(|character: char| {
        matches!(
            character,
            '"' | '\'' | '(' | ')' | '[' | ']' | '{' | '}' | ',' | ';'
        )
    });
    trimmed.contains(":\\")
        || trimmed.starts_with("\\\\")
        || trimmed.starts_with("./")
        || trimmed.starts_with("../")
        || trimmed.contains('/')
}

fn learning_summary(digest: &str, final_text: &str) -> String {
    let seed = if !final_text.trim().is_empty() {
        final_text
    } else {
        digest
    };
    let clean = sanitize_learning_text(seed, 120);
    if clean.is_empty() {
        "Aivatar noticed this session and saved a small impression.".to_string()
    } else if has_han_text(&clean) {
        format!(
            "Aivatar记住了一轮关于“{}”的对话",
            summarize_to_chars(&clean, 46)
        )
    } else {
        format!(
            "Aivatar noticed a session about {}",
            summarize_to_chars(&clean, 72)
        )
    }
}

fn learning_trait_changes(digest: &str, final_text: &str) -> Value {
    let text = format!("{digest} {final_text}").to_ascii_lowercase();
    let mut traits = serde_json::Map::new();
    if contains_any(&text, &["test", "build", "verify", "check", "review"]) {
        traits.insert("focus".to_string(), json!(1));
    }
    if contains_any(
        &text,
        &[
            "bug", "error", "failed", "failure", "fix", "repair", "debug",
        ],
    ) {
        traits.insert("resilience".to_string(), json!(1));
    }
    if contains_any(&text, &["design", "ui", "visual", "style", "css", "canvas"]) {
        traits.insert("creativity".to_string(), json!(1));
    }
    if contains_any(&text, &["learn", "research", "why", "explore", "discover"]) {
        traits.insert("curiosity".to_string(), json!(1));
    }
    if contains_any(
        &text,
        &["complete", "done", "finished", "success", "release"],
    ) {
        traits.insert("efficiency".to_string(), json!(1));
    }
    if contains_any(&text, &["warm", "cozy", "companion", "pet", "gentle"]) {
        traits.insert("warmth".to_string(), json!(1));
    }
    if traits.is_empty() {
        traits.insert("focus".to_string(), json!(1));
    }
    Value::Object(traits)
}

fn idle_bubble_candidates(digest: &str, language: &str) -> Vec<String> {
    let text = digest.to_ascii_lowercase();
    let mut phrases = Vec::new();
    let zh = language == "zh";
    if contains_any(
        &text,
        &[
            "bug", "error", "failed", "failure", "fix", "repair", "debug",
        ],
    ) {
        add_phrase(
            &mut phrases,
            if zh {
                "一点点修回来"
            } else {
                "Patch it back gently"
            },
        );
        add_phrase(
            &mut phrases,
            if zh {
                "先稳住现场"
            } else {
                "Steady hands"
            },
        );
    }
    if contains_any(&text, &["test", "build", "verify", "check", "review"]) {
        add_phrase(
            &mut phrases,
            if zh {
                "稳稳过一遍"
            } else {
                "One steady pass"
            },
        );
        add_phrase(
            &mut phrases,
            if zh {
                "检查也算前进"
            } else {
                "Checks count too"
            },
        );
    }
    if contains_any(&text, &["design", "ui", "visual", "style", "css", "canvas"]) {
        add_phrase(
            &mut phrases,
            if zh {
                "小细节发光"
            } else {
                "Tiny details glow"
            },
        );
        add_phrase(
            &mut phrases,
            if zh {
                "让界面会呼吸"
            } else {
                "Let the UI breathe"
            },
        );
    }
    if contains_any(&text, &["learn", "research", "why", "explore", "discover"]) {
        add_phrase(
            &mut phrases,
            if zh {
                "线索在发光"
            } else {
                "A clue is glowing"
            },
        );
        add_phrase(
            &mut phrases,
            if zh {
                "我学到一点点"
            } else {
                "I learned a little"
            },
        );
    }
    if contains_any(
        &text,
        &["complete", "done", "finished", "success", "release"],
    ) {
        add_phrase(
            &mut phrases,
            if zh {
                "干净收尾"
            } else {
                "Clean little finish"
            },
        );
        add_phrase(
            &mut phrases,
            if zh {
                "这个收好了"
            } else {
                "Win tucked away"
            },
        );
    }
    if phrases.is_empty() {
        add_phrase(
            &mut phrases,
            if zh {
                "陪你慢慢想"
            } else {
                "Thinking beside you"
            },
        );
        add_phrase(
            &mut phrases,
            if zh {
                "把这轮记住啦"
            } else {
                "Session thoughts saved"
            },
        );
        add_phrase(
            &mut phrases,
            if zh {
                "小气泡收好"
            } else {
                "Tiny memory tucked away"
            },
        );
    }
    phrases.truncate(6);
    phrases
}

fn add_phrase(phrases: &mut Vec<String>, phrase: &str) {
    let clean = phrase
        .chars()
        .filter(|character| character.is_alphanumeric() || character.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let length = clean.chars().count();
    if (2..=28).contains(&length) && !phrases.iter().any(|item| item == &clean) {
        phrases.push(clean);
    }
}

fn contains_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| text.contains(needle))
}

fn has_han_text(text: &str) -> bool {
    text.chars()
        .any(|character| ('\u{3400}'..='\u{9fff}').contains(&character))
}

fn learning_id(session_id: &str, phase: &str, summary: &str, digest: &str) -> String {
    let mut hasher = DefaultHasher::new();
    session_id.hash(&mut hasher);
    phase.hash(&mut hasher);
    summary.hash(&mut hasher);
    digest.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn summarize_to_chars(text: &str, limit: usize) -> String {
    let clean = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.chars().count() <= limit {
        return clean;
    }
    clean
        .chars()
        .take(limit.saturating_sub(3))
        .collect::<String>()
        + "..."
}

fn submit_status(status: Value) {
    let _ = local_bridge::submit_status(status);
}

fn status_event_key(status: &Value) -> String {
    format!(
        "{}:{}:{}",
        status.get("status").and_then(Value::as_str).unwrap_or(""),
        status.get("phase").and_then(Value::as_str).unwrap_or(""),
        status.get("message").and_then(Value::as_str).unwrap_or("")
    )
}

fn event_timestamp(record: &Value) -> String {
    string_field(record, "timestamp")
        .or_else(|| {
            record
                .get("payload")
                .and_then(|payload| string_field(payload, "timestamp"))
        })
        .unwrap_or_else(iso_now)
}

fn text_from_payload(payload: &Value) -> Option<String> {
    for field in ["message", "text", "summary"] {
        if let Some(value) = string_field(payload, field) {
            return Some(value);
        }
    }
    if let Some(items) = payload.get("content").and_then(Value::as_array) {
        let text = items
            .iter()
            .filter_map(|item| {
                item.as_str()
                    .map(String::from)
                    .or_else(|| string_field(item, "text"))
            })
            .collect::<Vec<_>>()
            .join(" ");
        if !text.trim().is_empty() {
            return Some(text);
        }
    }
    None
}

fn summarize(text: &str) -> String {
    let clean = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut summary = String::new();
    for character in clean.chars() {
        if summary.chars().count() >= SUMMARY_CHARS {
            summary.push_str("...");
            break;
        }
        summary.push(character);
    }
    if summary.is_empty() {
        "Codex session activity".to_string()
    } else {
        summary
    }
}

fn file_len(path: &Path) -> Result<u64, String> {
    std::fs::metadata(path)
        .map(|metadata| metadata.len())
        .map_err(|error| error.to_string())
}

fn string_field(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)?
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(String::from)
}

fn number_field(value: &Value, field: &str) -> Option<u64> {
    value.get(field)?.as_u64()
}

fn iso_now() -> String {
    chrono::Utc::now().to_rfc3339()
}
