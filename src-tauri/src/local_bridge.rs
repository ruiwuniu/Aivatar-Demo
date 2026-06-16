use std::{
    collections::{HashMap, HashSet},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{mpsc, Arc, Mutex, OnceLock},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Map, Value};
use tungstenite::{accept, Message};

const WS_PORT: u16 = 38987;
const HTTP_PORT: u16 = 38988;
const AGENT_WS_PATH: &str = "/agent-status";
const LEGACY_WS_PATH: &str = "/codex-status";
const AGENT_STATUS_PATH: &str = "/agent-status";
const LEGACY_STATUS_PATH: &str = "/codex-status";
const ACTIVE_SESSION_PATH: &str = "/agent-active";
const STALE_SESSIONS_PATH: &str = "/agent-sessions/stale";
const DISCONNECT_SESSION_PATH: &str = "/agent-sessions/disconnect";
const PRESENCE_PATH: &str = "/agent-presence";
const AVATAR_STATE_PATH: &str = "/avatar-state";
const CLAUDE_HOOK_PATH: &str = "/agent-hooks/claude-code";
const CLAUDE_STATUS_LINE_HOOK_PATH: &str = "/agent-hooks/claude-code/status-line";
const HEALTH_PATH: &str = "/health";
const SESSION_STALE_MS: u64 = 5 * 60 * 60 * 1000;
const ACTIVITY_STALE_MS: u64 = 5 * 60 * 1000;
const MAX_SESSIONS: usize = 80;
const MAX_CLAUDE_DIGEST_ENTRIES: usize = 12;

static BRIDGE_STATE: OnceLock<Arc<Mutex<BridgeState>>> = OnceLock::new();

#[derive(Default)]
struct BridgeState {
    sessions: HashMap<String, Value>,
    active_session_key: Option<String>,
    clients: Vec<mpsc::Sender<String>>,
    tombstones: HashMap<String, u128>,
    claude_digests: HashMap<String, Vec<String>>,
    claude_last_learning_keys: HashMap<String, String>,
    learning_script: Option<PathBuf>,
}

pub fn start(learning_script: Option<PathBuf>) -> Result<(), String> {
    if let Some(state) = BRIDGE_STATE.get() {
        if learning_script.is_some() {
            let mut guard = state.lock().expect("bridge state poisoned");
            guard.learning_script = learning_script;
        }
        return Ok(());
    }

    let http_listener = TcpListener::bind(("127.0.0.1", HTTP_PORT))
        .map_err(|error| format!("Could not bind native bridge HTTP port {HTTP_PORT}: {error}"))?;
    let ws_listener = TcpListener::bind(("127.0.0.1", WS_PORT)).map_err(|error| {
        format!("Could not bind native bridge WebSocket port {WS_PORT}: {error}")
    })?;

    let state = Arc::new(Mutex::new(BridgeState {
        learning_script,
        ..BridgeState::default()
    }));
    let _ = BRIDGE_STATE.set(Arc::clone(&state));

    let http_state = Arc::clone(&state);
    thread::spawn(move || {
        for stream in http_listener.incoming().flatten() {
            let state = Arc::clone(&http_state);
            thread::spawn(move || handle_http(stream, state));
        }
    });

    thread::spawn(move || {
        for stream in ws_listener.incoming().flatten() {
            let state = Arc::clone(&state);
            thread::spawn(move || handle_websocket(stream, state));
        }
    });

    Ok(())
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn iso_now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn session_expires_at() -> String {
    (chrono::Utc::now() + chrono::TimeDelta::milliseconds(SESSION_STALE_MS as i64)).to_rfc3339()
}

fn bridge_idle_status() -> Value {
    json!({
        "agent": "aivatar",
        "sessionId": "bridge",
        "status": "idle",
        "phase": "bridge",
        "task": "Waiting for agent status",
        "summary": "Aivatar bridge is online",
        "progress": 0,
        "message": "Aivatar bridge is online",
        "severity": "info",
        "timestamp": iso_now()
    })
}

fn string_field(value: &Value, field: &str) -> Option<String> {
    value.get(field)?.as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from)
}

fn number_field(value: &Value, field: &str) -> Option<f64> {
    value.get(field)?.as_f64().filter(|v| v.is_finite())
}

fn session_key(status: &Value) -> String {
    let agent = string_field(status, "agent").unwrap_or_else(|| "codex".to_string());
    let session_id = string_field(status, "sessionId").unwrap_or_else(|| "default".to_string());
    format!("{agent}:{session_id}")
}

fn parsed_ms(value: Option<&Value>) -> u128 {
    let Some(text) = value.and_then(Value::as_str) else {
        return 0;
    };
    text.parse::<u128>()
        .ok()
        .or_else(|| {
            chrono::DateTime::parse_from_rfc3339(text)
                .ok()
                .and_then(|date| u128::try_from(date.timestamp_millis()).ok())
        })
        .unwrap_or(0)
}

fn with_session_expiry(mut status: Value) -> Value {
    if let Some(object) = status.as_object_mut() {
        if !object
            .get("expiresAt")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
        {
            object.insert("expiresAt".to_string(), Value::String(session_expires_at()));
        }
    }
    status
}

fn is_session_expired(status: &Value) -> bool {
    let expires_at = parsed_ms(
        status
            .get("expiresAt")
            .or_else(|| status.get("presenceTimestamp"))
            .or_else(|| status.get("timestamp")),
    );
    expires_at > 0 && now_ms() > expires_at
}

fn is_activity_stale(status: &Value) -> bool {
    if is_session_expired(status) {
        return true;
    }
    let updated_at = parsed_ms(status.get("timestamp"));
    updated_at > 0 && now_ms().saturating_sub(updated_at) > ACTIVITY_STALE_MS as u128
}

fn status_name(status: &Value) -> Option<&str> {
    status.get("status").and_then(Value::as_str)
}

fn is_terminal_session_status(status: &Value) -> bool {
    matches!(status_name(status), Some("complete" | "error"))
}

fn should_preserve_claude_session_end(status: &Value, existing: &Value) -> bool {
    string_field(status, "agent").as_deref() == Some("claude-code")
        && string_field(status, "phase").as_deref() == Some("session-end")
        && string_field(status, "status").as_deref() == Some("idle")
        && is_terminal_session_status(existing)
}

fn is_claude_lifecycle_only_idle_status(status: &Value) -> bool {
    string_field(status, "agent").as_deref() == Some("claude-code")
        && string_field(status, "status").as_deref() == Some("idle")
        && matches!(
            string_field(status, "phase").as_deref(),
            Some("session-start" | "session-end" | "other")
        )
        && status.get("usage").is_none()
        && status.get("learning").is_none()
}

fn is_claude_desktop_inventory_status(status: &Value) -> bool {
    string_field(status, "agent").as_deref() == Some("claude-code")
        && string_field(status, "status").as_deref() == Some("idle")
        && matches!(
            string_field(status, "phase").as_deref(),
            Some("desktop-chat-session" | "desktop-cowork-session" | "desktop-code-session")
        )
}

fn is_claude_desktop_aliased_status(status: &Value) -> bool {
    string_field(status, "agent").as_deref() == Some("claude-code")
        && string_field(status, "desktopSessionId")
            .is_some_and(|value| !value.trim().is_empty())
}

fn status_merge_rank(status: &Value) -> u8 {
    match status_name(status) {
        Some("thinking" | "executing" | "waiting_for_user" | "error") => 4,
        Some("complete") => 3,
        Some("idle") => 1,
        Some(_) => 2,
        None => 0,
    }
}

fn claude_desktop_alias_key(
    state: &BridgeState,
    status: &Value,
    preferred_key: &str,
) -> Option<String> {
    if !is_claude_desktop_aliased_status(status) {
        return None;
    }
    let desktop_session_id = string_field(status, "desktopSessionId")?.to_ascii_lowercase();
    state
        .sessions
        .iter()
        .filter(|(key, existing)| {
            key.as_str() != preferred_key
                && string_field(existing, "agent").as_deref() == Some("claude-code")
                && string_field(existing, "desktopSessionId")
                    .map(|value| value.to_ascii_lowercase())
                    .as_deref()
                    == Some(desktop_session_id.as_str())
        })
        .max_by_key(|(_, existing)| status_merge_rank(existing))
        .map(|(key, _)| key.clone())
}

fn best_existing_status(exact: Option<Value>, alias: Option<Value>) -> Option<Value> {
    match (exact, alias) {
        (Some(exact), Some(alias))
            if status_name(&exact) == Some("idle") && status_name(&alias) != Some("idle") =>
        {
            Some(alias)
        }
        (Some(exact), _) => Some(exact),
        (None, alias) => alias,
    }
}

fn canonicalize_claude_desktop_alias_status(status: &mut Value, incoming: &Value) {
    if !is_claude_desktop_aliased_status(incoming) {
        return;
    }
    if let Some(object) = status.as_object_mut() {
        for field in ["agent", "sessionId", "desktopSessionId", "surface"] {
            if let Some(value) = incoming.get(field) {
                object.insert(field.to_string(), value.clone());
            }
        }
    }
}

fn merge_claude_desktop_inventory_status(status: Value, existing: &Value) -> Value {
    if string_field(existing, "status").as_deref() == Some("idle") {
        return status;
    }

    let mut merged = existing.clone();
    if let Some(object) = merged.as_object_mut() {
        for field in [
            "presenceTimestamp",
            "expiresAt",
            "surface",
            "desktopSessionId",
        ] {
            if let Some(value) = status.get(field) {
                object.insert(field.to_string(), value.clone());
            }
        }
    }
    merged
}

fn sorted_sessions(state: &BridgeState) -> Vec<Value> {
    let mut sessions: Vec<_> = state
        .sessions
        .values()
        .map(|status| {
            let mut next = status.clone();
            if let Some(object) = next.as_object_mut() {
                object.insert("connected".to_string(), Value::Bool(!is_session_expired(status)));
            }
            next
        })
        .collect();

    sessions.sort_by(|left, right| {
        let left_time = parsed_ms(
            left.get("timestamp")
                .or_else(|| left.get("presenceTimestamp")),
        );
        let right_time = parsed_ms(
            right.get("timestamp")
                .or_else(|| right.get("presenceTimestamp")),
        );
        right_time.cmp(&left_time)
    });
    sessions
}

fn choose_current_status(state: &BridgeState) -> Value {
    let high_priority: HashSet<&str> =
        ["thinking", "executing", "waiting_for_user", "error"].into_iter().collect();

    if let Some(active_key) = &state.active_session_key {
        if let Some(active) = state.sessions.get(active_key) {
            if !is_activity_stale(active) && status_name(active) != Some("idle") {
                return active.clone();
            }
        }
    }

    let candidates = sorted_sessions(state);
    if let Some(status) = candidates.iter().find(|status| {
        status_name(status)
            .map(|name| high_priority.contains(name))
            .unwrap_or(false)
            && !is_activity_stale(status)
    }) {
        return status.clone();
    }

    candidates
        .into_iter()
        .find(|status| status_name(status) != Some("idle") && !is_activity_stale(status))
        .unwrap_or_else(bridge_idle_status)
}

fn current_session_key(state: &BridgeState) -> Option<String> {
    let current = choose_current_status(state);
    if string_field(&current, "agent").as_deref() == Some("aivatar")
        && string_field(&current, "sessionId").as_deref() == Some("bridge")
    {
        None
    } else {
        Some(session_key(&current))
    }
}

fn connected_session_key(state: &BridgeState) -> Option<String> {
    state
        .active_session_key
        .as_ref()
        .filter(|key| state.sessions.contains_key(*key))
        .cloned()
}

fn prune_sessions(state: &mut BridgeState) -> usize {
    let before = state.sessions.len();
    state.sessions.retain(|_, status| {
        let keep = !is_session_expired(status);
        keep
    });
    if state
        .active_session_key
        .as_ref()
        .is_some_and(|key| !state.sessions.contains_key(key))
    {
        state.active_session_key = None;
    }

    if state.sessions.len() > MAX_SESSIONS {
        let mut removable: Vec<_> = state
            .sessions
            .iter()
            .filter(|(key, _)| Some(*key) != state.active_session_key.as_ref())
            .map(|(key, value)| {
                (
                    key.clone(),
                    parsed_ms(value.get("presenceTimestamp").or_else(|| value.get("timestamp"))),
                )
            })
            .collect();
        removable.sort_by_key(|(_, time)| *time);
        for (key, _) in removable {
            if state.sessions.len() <= MAX_SESSIONS {
                break;
            }
            state.sessions.remove(&key);
        }
    }

    before.saturating_sub(state.sessions.len())
}

fn snapshot(state: &BridgeState) -> Value {
    let current = choose_current_status(state);
    json!({
        "type": "aivatar.status.snapshot",
        "currentStatus": current,
        "sessions": sorted_sessions(state),
        "activeSessionKey": state.active_session_key,
        "connectedSessionKey": connected_session_key(state),
        "currentSessionKey": current_session_key(state),
        "timestamp": iso_now()
    })
}

fn broadcast(state: &Arc<Mutex<BridgeState>>) {
    let encoded = {
        let guard = state.lock().expect("bridge state poisoned");
        snapshot(&guard).to_string()
    };

    let mut guard = state.lock().expect("bridge state poisoned");
    guard.clients.retain(|client| client.send(encoded.clone()).is_ok());
}

fn normalize_status(payload: Value) -> Result<Value, String> {
    let Value::Object(source) = payload else {
        return Err("Status payload must be a JSON object".to_string());
    };

    let raw_status = source
        .get("status")
        .and_then(Value::as_str)
        .ok_or_else(|| "Status payload requires status".to_string())?;
    let status = match raw_status {
        "waiting" | "wait" | "waiting_for_input" | "input_required" | "needs_input"
        | "user_input" => "waiting_for_user",
        other => other,
    };
    if ![
        "idle",
        "thinking",
        "executing",
        "waiting_for_user",
        "error",
        "complete",
    ]
    .contains(&status)
    {
        return Err(format!("Unsupported status: {raw_status}"));
    }

    let mut object = Map::new();
    object.insert(
        "agent".to_string(),
        source
            .get("agent")
            .and_then(Value::as_str)
            .unwrap_or("codex")
            .into(),
    );
    if let Some(session_id) = source.get("sessionId").and_then(Value::as_str) {
        object.insert("sessionId".to_string(), session_id.into());
    }
    object.insert("status".to_string(), status.into());
    object.insert(
        "phase".to_string(),
        source
            .get("phase")
            .and_then(Value::as_str)
            .unwrap_or(status)
            .into(),
    );

    for field in ["task", "summary", "detail", "message"] {
        if let Some(value) = source.get(field).and_then(Value::as_str) {
            object.insert(field.to_string(), value.into());
        }
    }
    if let Some(progress) = number_field(&Value::Object(source.clone()), "progress") {
        object.insert("progress".to_string(), json!(progress));
    }
    object.insert(
        "severity".to_string(),
        match source.get("severity").and_then(Value::as_str) {
            Some("warning") => "warning",
            Some("error") => "error",
            _ => "info",
        }
        .into(),
    );
    let timestamp = source
        .get("timestamp")
        .and_then(Value::as_str)
        .map(String::from)
        .unwrap_or_else(iso_now);
    object.insert("timestamp".to_string(), timestamp.clone().into());
    object.insert(
        "presenceTimestamp".to_string(),
        source
            .get("presenceTimestamp")
            .and_then(Value::as_str)
            .map(String::from)
            .unwrap_or(timestamp)
            .into(),
    );
    for field in [
        "usage",
        "idleBubbleCandidates",
        "learning",
        "expiresAt",
        "source",
        "surface",
        "desktopSessionId",
    ] {
        if let Some(value) = source.get(field) {
            object.insert(field.to_string(), value.clone());
        }
    }

    Ok(Value::Object(object))
}

fn first_string(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    keys.iter()
        .filter_map(|key| object.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .find(|text| !text.is_empty())
        .map(String::from)
}

fn compact_hook_text(value: &str, limit: usize) -> String {
    let mut text = value
        .replace('\r', " ")
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    for marker in ["http://", "https://"] {
        if let Some(index) = text.find(marker) {
            text.truncate(index);
            text.push_str("[url]");
        }
    }
    text.chars().take(limit).collect()
}

fn sanitized_digest_text(value: &str, limit: usize) -> String {
    let mut words = Vec::new();
    let mut secret_next = false;
    let normalized = value.replace('\r', " ").replace('\n', " ");
    for raw in normalized.split_whitespace() {
        let lower = raw.to_ascii_lowercase();
        let word = if secret_next {
            secret_next = false;
            "[secret]"
        } else if lower.contains("api_key")
            || lower.contains("apikey")
            || lower.contains("token")
            || lower.contains("secret")
            || lower.contains("password")
        {
            secret_next = raw.ends_with(':') || raw.ends_with('=');
            "[secret]"
        } else if lower.starts_with("http://") || lower.starts_with("https://") {
            "[url]"
        } else if raw.contains('@') && raw.contains('.') {
            "[email]"
        } else if raw.contains('\\')
            || (raw.contains('/') && (raw.starts_with('/') || raw.starts_with('.') || raw.contains(":/")))
        {
            "[path]"
        } else {
            raw
        };
        words.push(word);
    }
    compact_hook_text(&words.join(" "), limit)
}

fn safe_session_name(value: &str) -> String {
    let safe: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect();
    if safe.is_empty() {
        "session".to_string()
    } else {
        safe
    }
}

fn claude_event_name(input: &Value, status_line: bool) -> String {
    first_string(
        input,
        &[
            "hook_event_name",
            "hookEventName",
            "event_name",
            "eventName",
            "event",
            "type",
            "name",
            "kind",
            "phase",
            "status",
        ],
    )
    .or_else(|| input.get("event").and_then(|value| {
        first_string(
            value,
            &[
                "hook_event_name",
                "hookEventName",
                "event_name",
                "eventName",
                "type",
                "name",
                "kind",
                "phase",
            ],
        )
    }))
    .or_else(|| input.get("payload").and_then(|value| {
        first_string(value, &["hook_event_name", "type", "name", "kind", "phase"])
    }))
    .or_else(|| input.get("data").and_then(|value| {
        first_string(value, &["hook_event_name", "type", "name", "kind", "phase"])
    }))
    .unwrap_or_else(|| {
        if status_line || input.get("context_window").is_some() {
            "StatusLine".to_string()
        } else {
            "Unknown".to_string()
        }
    })
}

fn claude_surface_label(input: &Value) -> &'static str {
    let mut text = String::new();
    for key in [
        "mode",
        "surface",
        "channel",
        "client_mode",
        "clientMode",
        "app_mode",
        "appMode",
        "source",
    ] {
        if let Some(value) = input.get(key).and_then(Value::as_str) {
            text.push_str(value);
            text.push(' ');
        }
    }
    text.push_str(&claude_event_name(input, false));
    let lower = text.to_ascii_lowercase();
    if lower.contains("cowork")
        || lower.contains("co-work")
        || lower.contains("teammate")
        || lower.contains("subagent")
    {
        "Claude Cowork"
    } else if lower.contains("chat") || lower.contains("conversation") {
        "Claude Chat"
    } else {
        "Claude Code"
    }
}

fn hash_string(value: &str) -> String {
    let mut hash: u32 = 2_166_136_261;
    for byte in value.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(16_777_619);
    }
    format!("{hash:x}")
}

fn claude_session_id(input: &Value) -> String {
    if let Some(explicit) = first_string(
        input,
        &[
            "session_id",
            "sessionId",
            "sessionID",
            "conversation_id",
            "conversationId",
            "thread_id",
            "threadId",
            "chat_id",
            "chatId",
            "cowork_session_id",
            "coworkSessionId",
        ],
    ) {
        return explicit;
    }
    for key in ["session", "conversation", "thread", "chat", "cowork"] {
        if let Some(nested) = input.get(key).and_then(|value| first_string(value, &["id"])) {
            return nested;
        }
    }
    if let Some(basis) = first_string(
        input,
        &[
            "session_name",
            "conversation_title",
            "conversationTitle",
            "title",
            "cwd",
        ],
    ) {
        let mut safe = safe_session_name(&format!("{}-{basis}", claude_surface_label(input)));
        safe = safe.chars().take(48).collect();
        return format!("claude-{safe}-{}", hash_string(&basis));
    }
    "claude-code-desktop".to_string()
}

fn claude_digest_entry(input: &Value) -> Option<String> {
    let event = claude_event_name(input, false);
    let entry = match event.as_str() {
        "UserPromptSubmit" => input
            .get("prompt")
            .and_then(Value::as_str)
            .map(|text| format!("user: {}", sanitized_digest_text(text, 520))),
        "MessageDisplay" => input
            .get("delta")
            .and_then(Value::as_str)
            .map(|text| format!("assistant: {}", sanitized_digest_text(text, 520))),
        "PreToolUse" | "PostToolUse" | "PostToolUseFailure" => {
            let tool = first_string(input, &["tool_name"]).unwrap_or_else(|| "tool".to_string());
            let description = input
                .get("tool_input")
                .and_then(|tool_input| first_string(tool_input, &["description", "query", "prompt"]))
                .map(|text| sanitized_digest_text(&text, 220))
                .filter(|text| !text.is_empty());
            Some(match description {
                Some(text) => format!("tool {tool}: {text}"),
                None => format!("tool {tool}"),
            })
        }
        "PermissionRequest" | "PermissionDenied" | "Notification" => first_string(
            input,
            &["message", "reason", "notification_type"],
        )
        .map(|text| format!("{event}: {}", sanitized_digest_text(&text, 220))),
        "Stop" | "TaskCompleted" => Some("turn: Claude Code completed the turn".to_string()),
        "StopFailure" => Some("turn: Claude Code reported an error".to_string()),
        _ => {
            let detail = first_string(
                input,
                &["prompt", "delta", "message", "text", "content", "summary", "title"],
            )
            .map(|text| sanitized_digest_text(&text, 520));
            let lower = event.to_ascii_lowercase();
            if lower.contains("prompt") || lower.contains("user") {
                detail.map(|text| format!("user: {text}"))
            } else if lower.contains("message")
                || lower.contains("chat")
                || lower.contains("assistant")
                || lower.contains("response")
                || lower.contains("delta")
            {
                detail.map(|text| format!("assistant: {text}"))
            } else {
                None
            }
        }
    }?;

    (!entry.trim().is_empty()).then_some(entry)
}

fn add_claude_digest(session_id: &str, entry: String) {
    let Some(state) = BRIDGE_STATE.get() else {
        return;
    };
    let mut guard = state.lock().expect("bridge state poisoned");
    let digest = guard
        .claude_digests
        .entry(session_id.to_string())
        .or_default();
    digest.push(entry);
    while digest.len() > MAX_CLAUDE_DIGEST_ENTRIES {
        digest.remove(0);
    }
}

fn take_claude_digest(session_id: &str) -> Vec<String> {
    let Some(state) = BRIDGE_STATE.get() else {
        return Vec::new();
    };
    let mut guard = state.lock().expect("bridge state poisoned");
    guard.claude_digests.remove(session_id).unwrap_or_default()
}

fn reset_claude_learning_key(session_id: &str) {
    let Some(state) = BRIDGE_STATE.get() else {
        return;
    };
    let mut guard = state.lock().expect("bridge state poisoned");
    guard.claude_last_learning_keys.remove(session_id);
}

fn mark_claude_learning_key(session_id: &str, key: &str) -> bool {
    let Some(state) = BRIDGE_STATE.get() else {
        return true;
    };
    let mut guard = state.lock().expect("bridge state poisoned");
    if guard
        .claude_last_learning_keys
        .get(session_id)
        .is_some_and(|current| current == key)
    {
        return false;
    }
    guard
        .claude_last_learning_keys
        .insert(session_id.to_string(), key.to_string());
    true
}

fn current_learning_script() -> Option<PathBuf> {
    let state = BRIDGE_STATE.get()?;
    let guard = state.lock().expect("bridge state poisoned");
    guard.learning_script.clone()
}

fn learning_enabled() -> bool {
    std::env::var("AIVATAR_LEARNING_ENABLED")
        .map(|value| !matches!(value.to_ascii_lowercase().as_str(), "0" | "false" | "no" | "off"))
        .unwrap_or(true)
}

fn learning_context_file(session_id: &str, digest: &[String], summary: &str) -> Result<PathBuf, String> {
    let directory = std::env::temp_dir().join("aivatar-learning-context");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(format!(
        "claude-native-{}-{}.txt",
        safe_session_name(session_id),
        now_ms()
    ));
    let mut content = String::new();
    if !summary.trim().is_empty() {
        content.push_str("summary: ");
        content.push_str(&sanitized_digest_text(summary, 220));
        content.push('\n');
    }
    for entry in digest {
        content.push_str(entry);
        content.push('\n');
    }
    if content.trim().is_empty() {
        content.push_str("Claude Code turn completed.\n");
    }
    std::fs::write(&path, content).map_err(|error| error.to_string())?;
    Ok(path)
}

fn node_command() -> PathBuf {
    std::env::var_os("AIVATAR_NODE_COMMAND")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("node"))
}

fn spawn_claude_learning_worker(status: &Value, digest: &[String]) -> bool {
    let Some(script) = current_learning_script().filter(|path| path.is_file()) else {
        return false;
    };
    let session_id =
        string_field(status, "sessionId").unwrap_or_else(|| "claude-code-desktop".to_string());
    let summary = string_field(status, "summary")
        .or_else(|| string_field(status, "message"))
        .unwrap_or_else(|| "Claude Code turn complete".to_string());
    let context_file = match learning_context_file(&session_id, digest, &summary) {
        Ok(path) => path,
        Err(_) => return false,
    };
    let mut command = std::process::Command::new(node_command());
    command
        .arg(script)
        .args([
            "--provider",
            "claude-code",
            "--agent",
            "claude-code",
            "--session",
            &session_id,
            "--status",
            status
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("complete"),
            "--summary",
            &summary,
            "--context-file",
        ])
        .arg(context_file)
        .arg("--avatar-state-file")
        .arg(avatar_state_file())
        .env("AIVATAR_AGENT", "claude-code")
        .env("AIVATAR_SESSION_ID", &session_id)
        .env("AIVATAR_LEARNING_PROVIDER", "claude-code")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    command.spawn().is_ok()
}

fn session_learning_status(status: &Value, learning: Value) -> Value {
    let summary = string_field(status, "summary")
        .or_else(|| string_field(status, "message"))
        .unwrap_or_else(|| "Claude Code turn complete".to_string());
    json!({
        "agent": "claude-code",
        "sessionId": string_field(status, "sessionId").unwrap_or_else(|| "claude-code-desktop".to_string()),
        "status": status.get("status").and_then(Value::as_str).unwrap_or("complete"),
        "phase": "session-learning",
        "task": summary,
        "summary": summary,
        "progress": if status.get("status").and_then(Value::as_str) == Some("complete") { 100 } else { 50 },
        "message": "Claude Code session learning updated",
        "severity": if status.get("status").and_then(Value::as_str) == Some("error") { "error" } else { "info" },
        "timestamp": iso_now(),
        "learning": learning
    })
}

fn claude_usage_from_input(input: &Value, terminal: bool) -> Option<Value> {
    let context = input.get("context_window")?.as_object()?;
    let current = context
        .get("current_usage")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let number = |key: &str| current.get(key).and_then(Value::as_f64).unwrap_or(0.0);
    let input_tokens =
        number("input_tokens") + number("cache_creation_input_tokens") + number("cache_read_input_tokens");
    let output_tokens = number("output_tokens")
        .max(context.get("total_output_tokens").and_then(Value::as_f64).unwrap_or(0.0));
    let total_tokens = input_tokens + output_tokens;
    if total_tokens <= 0.0 {
        return None;
    }
    Some(json!({
        "inputTokens": input_tokens.round(),
        "cachedInputTokens": number("cache_read_input_tokens").round(),
        "outputTokens": output_tokens.round(),
        "totalTokens": total_tokens.round(),
        "contextTokens": input_tokens.round(),
        "modelContextWindow": context
            .get("context_window_size")
            .and_then(Value::as_f64)
            .unwrap_or(200000.0)
            .round(),
        "source": "claude-code-native-statusline",
        "scope": if terminal { "turn" } else { "context-window" }
    }))
}

fn claude_status_for_event(event: &str, status_line: bool, _has_usage: bool) -> (&'static str, &'static str) {
    if status_line {
        return ("idle", "context-window");
    }
    match event {
        "SessionStart" => ("idle", "session-start"),
        "UserPromptSubmit" => ("thinking", "user-prompt"),
        "PreToolUse" | "PostToolUse" | "PostToolBatch" => ("executing", "tool-use"),
        "MessageDisplay" => ("thinking", "message-display"),
        "PermissionRequest" => ("waiting_for_user", "permission"),
        "PermissionDenied" | "StopFailure" | "PostToolUseFailure" => ("error", "error"),
        "Stop" | "SubagentStop" | "TeammateIdle" | "TaskCompleted" => ("complete", "turn-complete"),
        "SessionEnd" => ("idle", "session-end"),
        "Notification" => ("waiting_for_user", "notification"),
        _ => {
            let lower = event.to_ascii_lowercase();
            if lower.contains("permission")
                || lower.contains("approval")
                || lower.contains("waiting")
                || lower.contains("input_required")
            {
                ("waiting_for_user", "permission")
            } else if lower.contains("fail")
                || lower.contains("error")
                || lower.contains("exception")
            {
                ("error", "error")
            } else if lower.contains("stop")
                || lower.contains("complete")
                || lower.contains("done")
                || lower.contains("idle")
            {
                ("complete", "turn-complete")
            } else if lower.contains("tool")
                || lower.contains("command")
                || lower.contains("execute")
                || lower.contains("running")
            {
                ("executing", "tool-use")
            } else {
                ("thinking", "hook")
            }
        }
    }
}

fn claude_idle_bubbles(input: &Value) -> Option<Value> {
    let mut values = Vec::new();
    for key in ["session_name", "conversation_title", "conversationTitle", "message"] {
        if let Some(text) = input.get(key).and_then(Value::as_str) {
            let compact = compact_hook_text(text, 28);
            let length = compact.chars().count();
            if (2..=28).contains(&length) && !values.contains(&compact) {
                values.push(compact);
            }
        }
    }
    if values.is_empty() {
        None
    } else {
        Some(json!(values))
    }
}

fn native_learning_for_status(status: &Value, input: &Value) -> Option<Value> {
    let status_name = status.get("status").and_then(Value::as_str)?;
    if status_name != "complete" && status_name != "error" {
        return None;
    }
    let summary = status
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or("Claude Code turn complete");
    let text = format!(
        "{} {} {}",
        summary,
        first_string(input, &["tool_name", "hook_event_name", "eventName", "type"])
            .unwrap_or_default(),
        first_string(input, &["message", "session_name"]).unwrap_or_default()
    )
    .to_ascii_lowercase();
    let mut traits = Map::new();
    if text.contains("error") || text.contains("fail") || text.contains("fix") {
        traits.insert("resilience".to_string(), json!(1));
    }
    if text.contains("test") || text.contains("build") || text.contains("check") {
        traits.insert("focus".to_string(), json!(1));
    }
    if text.contains("ui") || text.contains("design") || text.contains("visual") {
        traits.insert("creativity".to_string(), json!(1));
    }
    if text.contains("complete") || text.contains("done") || text.contains("success") {
        traits.insert("efficiency".to_string(), json!(1));
    }
    Some(json!({
        "id": format!(
            "native-claude-{}-{}",
            status.get("sessionId").and_then(Value::as_str).unwrap_or("session"),
            now_ms()
        ),
        "source": "heuristic",
        "summary": compact_hook_text(summary, 160),
        "idleBubbleCandidates": claude_idle_bubbles(input)
            .unwrap_or_else(|| json!(["I learned a little", "Session thoughts saved"])),
        "traitChanges": traits,
        "xp": 2,
        "confidence": 0.35,
        "privacyRisk": "low"
    }))
}

fn normalize_claude_hook_status(input: Value, status_line: bool) -> Result<Value, String> {
    let event = claude_event_name(&input, status_line);
    let usage = claude_usage_from_input(
        &input,
        matches!(
            event.as_str(),
            "Stop" | "SubagentStop" | "TeammateIdle" | "TaskCompleted"
        ),
    );
    let (status, phase) = claude_status_for_event(&event, status_line, usage.is_some());
    let session_id = claude_session_id(&input);
    let label = claude_surface_label(&input);
    let message = match event.as_str() {
        "UserPromptSubmit" => format!("{label} is thinking"),
        "MessageDisplay" => format!("{label} is responding"),
        "PreToolUse" | "PostToolUse" | "PostToolBatch" => input
            .get("tool_name")
            .and_then(Value::as_str)
            .map(|tool| format!("{label} used {tool}"))
            .unwrap_or_else(|| format!("{label} is using a tool")),
        "PermissionRequest" => format!("{label} needs approval"),
        "Stop" | "SubagentStop" | "TeammateIdle" | "TaskCompleted" => {
            format!("{label} turn complete")
        }
        "StopFailure" | "PostToolUseFailure" => format!("{label} turn failed"),
        "SessionEnd" => format!("{label} session ended"),
        _ => format!("{label} {event}"),
    };
    let mut payload = json!({
        "agent": "claude-code",
        "sessionId": session_id,
        "status": status,
        "phase": phase,
        "task": message,
        "summary": message,
        "progress": if status == "complete" { 100 } else if status == "idle" { 0 } else { 50 },
        "message": message,
        "severity": if status == "error" { "error" } else if status == "waiting_for_user" { "warning" } else { "info" },
        "timestamp": iso_now(),
    });
    if let Some(usage) = usage {
        payload["usage"] = usage;
    }
    if let Some(candidates) = claude_idle_bubbles(&input) {
        payload["idleBubbleCandidates"] = candidates;
    }
    normalize_status(payload)
}

fn status_line_label(status: &Value) -> String {
    let usage = status.get("usage").and_then(Value::as_object);
    let total = usage
        .and_then(|value| value.get("totalTokens"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let window = usage
        .and_then(|value| value.get("modelContextWindow"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    if total > 0.0 && window > 0.0 {
        return format!("Aivatar {}% ctx", ((total / window) * 100.0).round());
    }
    "Aivatar linked".to_string()
}

fn normalize_presence(payload: Value) -> Result<Value, String> {
    let Value::Object(source) = payload else {
        return Err("Presence payload must be a JSON object".to_string());
    };
    let agent = source
        .get("agent")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Presence payload requires agent".to_string())?;
    let session_id = source
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Presence payload requires sessionId".to_string())?;
    let timestamp = source
        .get("timestamp")
        .and_then(Value::as_str)
        .map(String::from)
        .unwrap_or_else(iso_now);
    Ok(json!({
        "agent": agent,
        "sessionId": session_id,
        "timestamp": timestamp
    }))
}

pub fn submit_status(payload: Value) -> Result<Value, String> {
    let mut status = normalize_status(payload)?;
    let incoming_status = status.clone();
    let key = session_key(&status);
    let state = BRIDGE_STATE
        .get()
        .ok_or_else(|| "Native bridge is not running.".to_string())?;

    let mut guard = state.lock().expect("bridge state poisoned");
    if guard.tombstones.get(&key).is_some_and(|expires| now_ms() <= *expires) {
        let mut response = snapshot(&guard);
        if let Some(object) = response.as_object_mut() {
            object.insert("ignored".to_string(), json!(true));
            object.insert("disconnectedSessionKey".to_string(), json!(key));
        }
        return Ok(response);
    }
    let alias_key = claude_desktop_alias_key(&guard, &status, &key);
    let existing = best_existing_status(
        guard.sessions.get(&key).cloned(),
        alias_key
            .as_ref()
            .and_then(|alias_key| guard.sessions.get(alias_key).cloned()),
    );
    if existing.is_none() && is_claude_lifecycle_only_idle_status(&status) {
        let mut response = snapshot(&guard);
        if let Some(object) = response.as_object_mut() {
            object.insert("ignored".to_string(), json!(true));
            object.insert("ignoredLifecycleOnly".to_string(), json!(true));
            object.insert("ignoredSessionKey".to_string(), json!(key));
        }
        return Ok(response);
    }
    if let Some(existing) = existing {
        let preserve_claude_session_end =
            should_preserve_claude_session_end(&status, &existing);
        let context_window_only =
            string_field(&status, "phase").as_deref() == Some("context-window");
        if preserve_claude_session_end {
            let mut merged = existing;
            if let Some(object) = merged.as_object_mut() {
                for field in ["timestamp", "presenceTimestamp", "usage", "idleBubbleCandidates", "learning"] {
                    if let Some(value) = status.get(field) {
                        object.insert(field.to_string(), value.clone());
                    }
                }
            }
            status = merged;
        } else if context_window_only {
            let mut merged = existing;
            if let Some(object) = merged.as_object_mut() {
                for field in ["presenceTimestamp", "usage", "idleBubbleCandidates", "learning"] {
                    if let Some(value) = status.get(field) {
                        object.insert(field.to_string(), value.clone());
                    }
                }
            }
            status = merged;
        } else if is_claude_desktop_inventory_status(&status) {
            status = merge_claude_desktop_inventory_status(status, &existing);
        } else if let Some(object) = status.as_object_mut() {
            for field in ["presenceTimestamp", "usage", "idleBubbleCandidates", "learning"] {
                if !object.contains_key(field) {
                    if let Some(value) = existing.get(field) {
                        object.insert(field.to_string(), value.clone());
                    }
                }
            }
        }
    }
    if alias_key.as_deref().is_some_and(|alias| alias != key) {
        canonicalize_claude_desktop_alias_status(&mut status, &incoming_status);
    }
    guard.sessions.insert(key.clone(), with_session_expiry(status));
    if let Some(alias_key) = alias_key {
        if alias_key != key {
            guard.sessions.remove(&alias_key);
            if guard.active_session_key.as_deref() == Some(alias_key.as_str()) {
                guard.active_session_key = Some(key);
            }
        }
    }
    prune_sessions(&mut guard);
    let response = snapshot(&guard);
    drop(guard);
    broadcast(state);
    Ok(response)
}

pub fn submit_presence(payload: Value) -> Result<Value, String> {
    let presence = normalize_presence(payload)?;
    let key = session_key(&presence);
    let state = BRIDGE_STATE
        .get()
        .ok_or_else(|| "Native bridge is not running.".to_string())?;

    let mut guard = state.lock().expect("bridge state poisoned");
    if guard.tombstones.get(&key).is_some_and(|expires| now_ms() <= *expires) {
        let mut response = snapshot(&guard);
        if let Some(object) = response.as_object_mut() {
            object.insert("ignored".to_string(), json!(true));
            object.insert("disconnectedSessionKey".to_string(), json!(key));
        }
        return Ok(response);
    }
    let timestamp = string_field(&presence, "timestamp").unwrap_or_else(iso_now);
    let existing = guard.sessions.get(&key).cloned().unwrap_or_else(|| {
        json!({
            "agent": string_field(&presence, "agent"),
            "sessionId": string_field(&presence, "sessionId"),
            "status": "idle",
            "phase": "presence",
            "task": "Session online",
            "summary": "Session online",
            "progress": 0,
            "message": "Session online",
            "severity": "info",
            "timestamp": timestamp
        })
    });
    let mut next = existing;
    if let Some(object) = next.as_object_mut() {
        object.insert("presenceTimestamp".to_string(), json!(timestamp));
    }
    guard.sessions.insert(key, with_session_expiry(next));
    prune_sessions(&mut guard);
    let response = snapshot(&guard);
    drop(guard);
    broadcast(state);
    Ok(response)
}

fn normalize_avatar_state(payload: Value) -> Result<Value, String> {
    let Value::Object(source) = payload else {
        return Err("Avatar state payload must be a JSON object".to_string());
    };
    let growth = source.get("growth").and_then(Value::as_object);
    let source_traits = growth
        .and_then(|value| value.get("traits"))
        .and_then(Value::as_object)
        .or_else(|| source.get("traits").and_then(Value::as_object));
    let mut traits = Map::new();
    for trait_name in [
        "focus",
        "resilience",
        "curiosity",
        "efficiency",
        "creativity",
        "warmth",
    ] {
        let value = source_traits
            .and_then(|traits| traits.get(trait_name))
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
            .max(0.0)
            .round();
        traits.insert(trait_name.to_string(), json!(value));
    }
    let level = growth
        .and_then(|value| value.get("level"))
        .or_else(|| source.get("level"))
        .and_then(Value::as_f64)
        .unwrap_or(1.0)
        .max(1.0)
        .round();
    let idle_language = source
        .get("preferences")
        .and_then(Value::as_object)
        .and_then(|prefs| prefs.get("idleBubbleLanguage"))
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "zh" | "en" | "mixed"))
        .unwrap_or("auto");

    Ok(json!({
        "avatarId": source.get("avatarId").and_then(Value::as_str),
        "avatarName": source.get("avatarName").and_then(Value::as_str),
        "growth": {
            "level": level,
            "traits": traits
        },
        "preferences": {
            "idleBubbleLanguage": idle_language
        },
        "updatedAt": iso_now()
    }))
}

fn avatar_state_file() -> PathBuf {
    std::env::var_os("AIVATAR_AVATAR_STATE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("aivatar-avatar-state.json"))
}

fn write_avatar_state(state: &Value) -> Result<(), String> {
    let path = avatar_state_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(&path, serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?)
        .map_err(|error| error.to_string())
}

fn handle_websocket(stream: TcpStream, state: Arc<Mutex<BridgeState>>) {
    let Ok(mut websocket) = accept(stream) else {
        return;
    };
    let (sender, receiver) = mpsc::channel::<String>();
    {
        let mut guard = state.lock().expect("bridge state poisoned");
        let _ = sender.send(snapshot(&guard).to_string());
        guard.clients.push(sender);
    }

    while let Ok(payload) = receiver.recv() {
        if websocket.send(Message::Text(payload)).is_err() {
            break;
        }
    }
}

struct HttpRequest {
    method: String,
    path: String,
    body: String,
}

fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| error.to_string())?;
    let mut buffer = Vec::new();
    let mut temp = [0_u8; 4096];
    let header_end;
    loop {
        let read = stream.read(&mut temp).map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("Connection closed".to_string());
        }
        buffer.extend_from_slice(&temp[..read]);
        if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            header_end = index + 4;
            break;
        }
        if buffer.len() > 128 * 1024 {
            return Err("Request is too large".to_string());
        }
    }

    let headers = String::from_utf8_lossy(&buffer[..header_end]);
    let mut lines = headers.lines();
    let request_line = lines.next().ok_or_else(|| "Missing request line".to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts
        .next()
        .unwrap_or("/")
        .split('?')
        .next()
        .unwrap_or("/")
        .to_string();
    let content_length = lines
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.trim().parse::<usize>().ok())
        .unwrap_or(0);

    let mut body = buffer[header_end..].to_vec();
    while body.len() < content_length {
        let read = stream.read(&mut temp).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&temp[..read]);
        if body.len() > 128 * 1024 {
            return Err("Request body is too large".to_string());
        }
    }
    body.truncate(content_length);

    Ok(HttpRequest {
        method,
        path,
        body: String::from_utf8_lossy(&body).to_string(),
    })
}

fn send_json(stream: &mut TcpStream, status: u16, payload: Value) {
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "OK",
    };
    let body = if status == 204 {
        String::new()
    } else {
        payload.to_string()
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\ncontent-type: application/json; charset=utf-8\r\naccess-control-allow-origin: *\r\naccess-control-allow-methods: GET,POST,DELETE,OPTIONS\r\naccess-control-allow-headers: content-type\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

fn parse_body(body: &str) -> Result<Value, String> {
    if body.trim().is_empty() {
        return Err("Request payload must be a JSON object".to_string());
    }
    serde_json::from_str(body).map_err(|error| error.to_string())
}

fn handle_http(mut stream: TcpStream, state: Arc<Mutex<BridgeState>>) {
    let request = match read_http_request(&mut stream) {
        Ok(request) => request,
        Err(error) => {
            send_json(&mut stream, 400, json!({ "error": error }));
            return;
        }
    };

    if request.method == "OPTIONS" {
        send_json(&mut stream, 204, json!({}));
        return;
    }

    match (request.method.as_str(), request.path.as_str()) {
        ("GET", HEALTH_PATH) => {
            let guard = state.lock().expect("bridge state poisoned");
            send_json(
                &mut stream,
                200,
                json!({
                    "ok": true,
                    "native": true,
                    "websocket": format!("ws://127.0.0.1:{WS_PORT}{AGENT_WS_PATH}"),
                    "legacyWebsocket": format!("ws://127.0.0.1:{WS_PORT}{LEGACY_WS_PATH}"),
                    "http": format!("http://127.0.0.1:{HTTP_PORT}{AGENT_STATUS_PATH}"),
                    "legacyHttp": format!("http://127.0.0.1:{HTTP_PORT}{LEGACY_STATUS_PATH}"),
                    "activeSessionHttp": format!("http://127.0.0.1:{HTTP_PORT}{ACTIVE_SESSION_PATH}"),
                    "staleSessionsHttp": format!("http://127.0.0.1:{HTTP_PORT}{STALE_SESSIONS_PATH}"),
                    "disconnectSessionHttp": format!("http://127.0.0.1:{HTTP_PORT}{DISCONNECT_SESSION_PATH}"),
                    "presenceHttp": format!("http://127.0.0.1:{HTTP_PORT}{PRESENCE_PATH}"),
                    "avatarStateHttp": format!("http://127.0.0.1:{HTTP_PORT}{AVATAR_STATE_PATH}"),
                    "clients": guard.clients.len(),
                    "sessionStaleMs": SESSION_STALE_MS,
                    "activityStaleMs": ACTIVITY_STALE_MS,
                    "currentStatus": choose_current_status(&guard),
                    "agentStatus": choose_current_status(&guard),
                    "codexStatus": choose_current_status(&guard),
                    "sessions": sorted_sessions(&guard),
                    "activeSessionKey": guard.active_session_key,
                    "connectedSessionKey": connected_session_key(&guard),
                    "currentSessionKey": current_session_key(&guard),
                }),
            );
        }
        ("GET", AGENT_STATUS_PATH) | ("GET", LEGACY_STATUS_PATH) => {
            let guard = state.lock().expect("bridge state poisoned");
            send_json(&mut stream, 200, snapshot(&guard));
        }
        ("GET", ACTIVE_SESSION_PATH) => {
            let guard = state.lock().expect("bridge state poisoned");
            send_json(
                &mut stream,
                200,
                json!({
                    "activeSessionKey": guard.active_session_key,
                    "connectedSessionKey": connected_session_key(&guard),
                    "currentSessionKey": current_session_key(&guard),
                }),
            );
        }
        ("POST", ACTIVE_SESSION_PATH) => match parse_body(&request.body) {
            Ok(payload) => {
                let mut guard = state.lock().expect("bridge state poisoned");
                if payload.get("clear").and_then(Value::as_bool) == Some(true) {
                    guard.active_session_key = None;
                } else {
                    let agent = string_field(&payload, "agent").unwrap_or_default();
                    let session_id = string_field(&payload, "sessionId").unwrap_or_default();
                    if agent.is_empty() || session_id.is_empty() {
                        send_json(
                            &mut stream,
                            400,
                            json!({ "error": "Active session payload requires agent and sessionId" }),
                        );
                        return;
                    }
                    let key = format!("{agent}:{session_id}");
                    guard.tombstones.remove(&key);
                    guard.active_session_key = Some(key);
                }
                let response = snapshot(&guard);
                drop(guard);
                broadcast(&state);
                send_json(&mut stream, 202, response);
            }
            Err(error) => send_json(&mut stream, 400, json!({ "error": error })),
        },
        ("DELETE", STALE_SESSIONS_PATH) => {
            let mut guard = state.lock().expect("bridge state poisoned");
            let deleted_sessions = prune_sessions(&mut guard);
            let mut response = snapshot(&guard);
            if let Some(object) = response.as_object_mut() {
                object.insert("deletedSessions".to_string(), json!(deleted_sessions));
            }
            drop(guard);
            broadcast(&state);
            send_json(&mut stream, 202, response);
        }
        ("POST", DISCONNECT_SESSION_PATH) => match parse_body(&request.body) {
            Ok(payload) => {
                let agent = string_field(&payload, "agent").unwrap_or_default();
                let session_id = string_field(&payload, "sessionId").unwrap_or_default();
                if agent.is_empty() || session_id.is_empty() {
                    send_json(
                        &mut stream,
                        400,
                        json!({ "error": "Disconnect session payload requires agent and sessionId" }),
                    );
                    return;
                }
                let key = format!("{agent}:{session_id}");
                let mut guard = state.lock().expect("bridge state poisoned");
                let deleted_sessions = usize::from(guard.sessions.remove(&key).is_some());
                if guard.active_session_key.as_deref() == Some(&key) {
                    guard.active_session_key = None;
                }
                guard.tombstones.insert(key, now_ms() + 24 * 60 * 60 * 1000);
                let mut response = snapshot(&guard);
                if let Some(object) = response.as_object_mut() {
                    object.insert("deletedSessions".to_string(), json!(deleted_sessions));
                    object.insert("stoppedProcesses".to_string(), json!(0));
                }
                drop(guard);
                broadcast(&state);
                send_json(&mut stream, 202, response);
            }
            Err(error) => send_json(&mut stream, 400, json!({ "error": error })),
        },
        ("POST", PRESENCE_PATH) => match parse_body(&request.body).and_then(normalize_presence) {
            Ok(presence) => {
                let key = session_key(&presence);
                let mut guard = state.lock().expect("bridge state poisoned");
                if guard.tombstones.get(&key).is_some_and(|expires| now_ms() <= *expires) {
                    let mut response = snapshot(&guard);
                    if let Some(object) = response.as_object_mut() {
                        object.insert("ignored".to_string(), json!(true));
                        object.insert("disconnectedSessionKey".to_string(), json!(key));
                    }
                    send_json(&mut stream, 202, response);
                    return;
                }
                let timestamp = string_field(&presence, "timestamp").unwrap_or_else(iso_now);
                let existing = guard.sessions.get(&key).cloned().unwrap_or_else(|| {
                    json!({
                        "agent": string_field(&presence, "agent"),
                        "sessionId": string_field(&presence, "sessionId"),
                        "status": "idle",
                        "phase": "presence",
                        "task": "Session online",
                        "summary": "Session online",
                        "progress": 0,
                        "message": "Session online",
                        "severity": "info",
                        "timestamp": timestamp
                    })
                });
                let mut next = existing;
                if let Some(object) = next.as_object_mut() {
                    object.insert("presenceTimestamp".to_string(), json!(timestamp));
                }
                guard.sessions.insert(key, with_session_expiry(next));
                prune_sessions(&mut guard);
                let response = snapshot(&guard);
                drop(guard);
                broadcast(&state);
                send_json(&mut stream, 202, response);
            }
            Err(error) => send_json(&mut stream, 400, json!({ "error": error })),
        },
        ("POST", CLAUDE_HOOK_PATH) | ("POST", CLAUDE_STATUS_LINE_HOOK_PATH) => {
            let status_line = request.path == CLAUDE_STATUS_LINE_HOOK_PATH;
            match parse_body(&request.body) {
                Ok(input) => match normalize_claude_hook_status(input.clone(), status_line) {
                    Ok(status) => {
                        let session_id = string_field(&status, "sessionId")
                            .unwrap_or_else(|| "claude-code-desktop".to_string());
                        let event = claude_event_name(&input, status_line);
                        if event == "UserPromptSubmit" {
                            reset_claude_learning_key(&session_id);
                        }
                        if !status_line {
                            if let Some(entry) = claude_digest_entry(&input) {
                                add_claude_digest(&session_id, entry);
                            }
                        }
                        let terminal = matches!(
                            status.get("status").and_then(Value::as_str),
                            Some("complete" | "error")
                        );
                        let learning_key = first_string(&input, &["turn_id", "message_id"])
                            .unwrap_or_else(|| format!("{session_id}:{event}"));
                        let digest = if terminal {
                            take_claude_digest(&session_id)
                        } else {
                            Vec::new()
                        };
                        let fallback_learning = if terminal {
                            native_learning_for_status(&status, &input)
                        } else {
                            None
                        };
                        match submit_status(status.clone()) {
                            Ok(mut response) => {
                                if terminal
                                    && learning_enabled()
                                    && mark_claude_learning_key(&session_id, &learning_key)
                                    && !spawn_claude_learning_worker(&status, &digest)
                                {
                                    if let Some(learning) = fallback_learning {
                                        let _ = submit_status(session_learning_status(&status, learning));
                                    }
                                }
                                if status_line {
                                    if let Some(object) = response.as_object_mut() {
                                        object.insert("label".to_string(), json!(status_line_label(&status)));
                                    }
                                }
                                send_json(&mut stream, 200, response);
                            }
                            Err(error) => send_json(&mut stream, 400, json!({ "error": error })),
                        }
                    }
                    Err(error) => send_json(&mut stream, 400, json!({ "error": error })),
                },
                Err(error) => send_json(&mut stream, 400, json!({ "error": error })),
            }
        }
        ("POST", AGENT_STATUS_PATH) | ("POST", LEGACY_STATUS_PATH) => {
            match parse_body(&request.body).and_then(submit_status) {
                Ok(response) => send_json(&mut stream, 202, response),
                Err(error) => send_json(&mut stream, 400, json!({ "error": error })),
            }
        }
        ("POST", AVATAR_STATE_PATH) => {
            match parse_body(&request.body)
                .and_then(normalize_avatar_state)
                .and_then(|state| {
                    write_avatar_state(&state)?;
                    Ok(state)
                }) {
                Ok(state) => send_json(
                    &mut stream,
                    202,
                    json!({
                        "ok": true,
                        "avatarStateFile": avatar_state_file(),
                        "updatedAt": state.get("updatedAt")
                    }),
                ),
                Err(error) => send_json(&mut stream, 400, json!({ "error": error })),
            }
        }
        _ => send_json(&mut stream, 404, json!({ "error": "Not found" })),
    }
}
