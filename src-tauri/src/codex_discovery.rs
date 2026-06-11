use std::{
    collections::{HashMap, HashSet},
    hash::{Hash, Hasher},
    fs::File,
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    collections::hash_map::DefaultHasher,
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant, SystemTime},
};

use serde_json::{json, Value};

use crate::local_bridge;

const AGENT: &str = "codex";
const DEFAULT_ACTIVE_MS: u64 = 5 * 60 * 60 * 1000;
const DISCOVERY_INTERVAL: Duration = Duration::from_secs(3);
const WATCH_INTERVAL: Duration = Duration::from_millis(500);
const MAX_ROLLOUTS_PER_SCAN: usize = 160;
const MAX_LINE_CHARS: usize = 32 * 1024;
const SUMMARY_CHARS: usize = 90;
const DIGEST_ENTRY_LIMIT: usize = 8;
const DIGEST_ENTRY_CHARS: usize = 360;

static STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Clone)]
struct SessionMeta {
    session_id: String,
    cwd: Option<String>,
    timestamp: Option<String>,
    path: PathBuf,
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

pub fn start() -> Result<(), String> {
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
    let mut last_scan = Instant::now() - DISCOVERY_INTERVAL;

    loop {
        if last_scan.elapsed() >= DISCOVERY_INTERVAL {
            if let Some(root) = sessions_root() {
                for meta in discover_sessions(&root) {
                    refresh_presence(&meta);
                    watched.entry(meta.session_id.clone()).or_insert_with(|| {
                        submit_status(discovered_status(&meta));
                        let latest_usage = read_latest_token_usage(&meta.path);
                        WatchedSession {
                            offset: file_len(&meta.path).unwrap_or(0),
                            path: meta.path.clone(),
                            cwd: meta.cwd.clone(),
                            last_event_key: None,
                            usage_baseline: latest_usage.as_ref().map(|usage| usage.total.clone()),
                            latest_usage,
                            digest_entries: Vec::new(),
                            last_learning_id: None,
                        }
                    });
                }
            }
            last_scan = Instant::now();
        }

        let stale_paths: HashSet<String> = watched
            .iter_mut()
            .filter_map(|(session_id, session)| {
                match tail_session(session_id, session) {
                    Ok(()) => None,
                    Err(_) => Some(session_id.clone()),
                }
            })
            .collect();
        for session_id in stale_paths {
            watched.remove(&session_id);
        }

        thread::sleep(WATCH_INTERVAL);
    }
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
            timestamp: string_field(payload, "timestamp").or_else(|| string_field(&record, "timestamp")),
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
    let record_type = record.get("type").and_then(Value::as_str);
    let payload = record.get("payload").unwrap_or(record);
    let payload_type = payload.get("type").and_then(Value::as_str);
    let phase = payload
        .get("phase")
        .and_then(Value::as_str)
        .unwrap_or_default();

    let status = match (record_type, payload_type, phase) {
        (Some("event_msg"), Some("token_count"), _) => {
            if let Some(snapshot) = usage_snapshot_from_record(record) {
                session.latest_usage = Some(snapshot.clone());
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
                ))
            } else {
                None
            }
        }
        (Some("event_msg"), Some("user_message"), _) => {
            session.usage_baseline = session.latest_usage.as_ref().map(|usage| usage.total.clone());
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
            ))
        }
        (Some("response_item"), Some("function_call" | "custom_tool_call"), _) => {
            if session.usage_baseline.is_none() {
                session.usage_baseline = session.latest_usage.as_ref().map(|usage| usage.total.clone());
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
            ))
        }
        (
            Some("response_item"),
            Some("function_call_output" | "custom_tool_call_output"),
            _,
        ) => {
            if session.usage_baseline.is_none() {
                session.usage_baseline = session.latest_usage.as_ref().map(|usage| usage.total.clone());
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
            ))
        }
        (Some("event_msg"), Some("agent_message"), "final" | "final_answer") => {
            let final_text = text_from_payload(payload).unwrap_or_else(|| "Task finished".to_string());
            remember_digest(session, "assistant", &final_text);
            let usage = completion_usage(session);
            let learning = heuristic_learning(session_id, phase, &final_text, session);
            session.usage_baseline = None;
            session.digest_entries.clear();
            Some(build_status(
                session_id,
                "complete",
                phase,
                final_text,
                100,
                &session.cwd,
                usage,
                learning,
            ))
        }
        _ => None,
    };

    if let Some(status) = status {
        let event_key = status_event_key(&status);
        if session.last_event_key.as_deref() == Some(event_key.as_str()) {
            return;
        }
        session.last_event_key = Some(event_key);
        submit_status(status);
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
        "timestamp": iso_now()
    });
    if let Some(cwd) = cwd {
        if let Some(object) = payload.as_object_mut() {
            object.insert("detail".to_string(), json!(format!("Codex session in {cwd}")));
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

fn read_latest_token_usage(path: &Path) -> Option<UsageSnapshot> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);
    let mut latest = None;
    for line in reader.lines().map_while(Result::ok) {
        if line.len() > MAX_LINE_CHARS || line.trim().is_empty() {
            continue;
        }
        let Ok(record) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(snapshot) = usage_snapshot_from_record(&record) {
            latest = Some(snapshot);
        }
    }
    latest
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
    (usage.total_tokens > 0).then(|| usage_to_aivatar(
        &usage,
        scope,
        latest.last.as_ref(),
        latest.model_context_window,
    ))
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
                object.insert("modelContextWindow".to_string(), json!(model_context_window));
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
    session.digest_entries.push(DigestEntry { role, text: clean });
    if session.digest_entries.len() > DIGEST_ENTRY_LIMIT {
        let overflow = session.digest_entries.len() - DIGEST_ENTRY_LIMIT;
        session.digest_entries.drain(0..overflow);
    }
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
        matches!(character, '"' | '\'' | '(' | ')' | '[' | ']' | '{' | '}' | ',' | ';')
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
        format!("Aivatar记住了一轮关于“{}”的对话", summarize_to_chars(&clean, 46))
    } else {
        format!("Aivatar noticed a session about {}", summarize_to_chars(&clean, 72))
    }
}

fn learning_trait_changes(digest: &str, final_text: &str) -> Value {
    let text = format!("{digest} {final_text}").to_ascii_lowercase();
    let mut traits = serde_json::Map::new();
    if contains_any(&text, &["test", "build", "verify", "check", "review"]) {
        traits.insert("focus".to_string(), json!(1));
    }
    if contains_any(&text, &["bug", "error", "failed", "failure", "fix", "repair", "debug"]) {
        traits.insert("resilience".to_string(), json!(1));
    }
    if contains_any(&text, &["design", "ui", "visual", "style", "css", "canvas"]) {
        traits.insert("creativity".to_string(), json!(1));
    }
    if contains_any(&text, &["learn", "research", "why", "explore", "discover"]) {
        traits.insert("curiosity".to_string(), json!(1));
    }
    if contains_any(&text, &["complete", "done", "finished", "success", "release"]) {
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
    if contains_any(&text, &["bug", "error", "failed", "failure", "fix", "repair", "debug"]) {
        add_phrase(&mut phrases, if zh { "一点点修回来" } else { "Patch it back gently" });
        add_phrase(&mut phrases, if zh { "先稳住现场" } else { "Steady hands" });
    }
    if contains_any(&text, &["test", "build", "verify", "check", "review"]) {
        add_phrase(&mut phrases, if zh { "稳稳过一遍" } else { "One steady pass" });
        add_phrase(&mut phrases, if zh { "检查也算前进" } else { "Checks count too" });
    }
    if contains_any(&text, &["design", "ui", "visual", "style", "css", "canvas"]) {
        add_phrase(&mut phrases, if zh { "小细节发光" } else { "Tiny details glow" });
        add_phrase(&mut phrases, if zh { "让界面会呼吸" } else { "Let the UI breathe" });
    }
    if contains_any(&text, &["learn", "research", "why", "explore", "discover"]) {
        add_phrase(&mut phrases, if zh { "线索在发光" } else { "A clue is glowing" });
        add_phrase(&mut phrases, if zh { "我学到一点点" } else { "I learned a little" });
    }
    if contains_any(&text, &["complete", "done", "finished", "success", "release"]) {
        add_phrase(&mut phrases, if zh { "干净收尾" } else { "Clean little finish" });
        add_phrase(&mut phrases, if zh { "这个收好了" } else { "Win tucked away" });
    }
    if phrases.is_empty() {
        add_phrase(&mut phrases, if zh { "陪你慢慢想" } else { "Thinking beside you" });
        add_phrase(&mut phrases, if zh { "把这轮记住啦" } else { "Session thoughts saved" });
        add_phrase(&mut phrases, if zh { "小气泡收好" } else { "Tiny memory tucked away" });
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
    clean.chars().take(limit.saturating_sub(3)).collect::<String>() + "..."
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
