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
const HEALTH_PATH: &str = "/health";
const SESSION_STALE_MS: u64 = 5 * 60 * 60 * 1000;
const ACTIVITY_STALE_MS: u64 = 5 * 60 * 1000;
const MAX_SESSIONS: usize = 80;

static BRIDGE_STATE: OnceLock<Arc<Mutex<BridgeState>>> = OnceLock::new();

#[derive(Default)]
struct BridgeState {
    sessions: HashMap<String, Value>,
    active_session_key: Option<String>,
    clients: Vec<mpsc::Sender<String>>,
    tombstones: HashMap<String, u128>,
}

pub fn start() -> Result<(), String> {
    if BRIDGE_STATE.get().is_some() {
        return Ok(());
    }

    let http_listener = TcpListener::bind(("127.0.0.1", HTTP_PORT))
        .map_err(|error| format!("Could not bind native bridge HTTP port {HTTP_PORT}: {error}"))?;
    let ws_listener = TcpListener::bind(("127.0.0.1", WS_PORT)).map_err(|error| {
        format!("Could not bind native bridge WebSocket port {WS_PORT}: {error}")
    })?;

    let state = Arc::new(Mutex::new(BridgeState::default()));
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
        object.insert("expiresAt".to_string(), Value::String(session_expires_at()));
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
    for field in ["usage", "idleBubbleCandidates", "learning"] {
        if let Some(value) = source.get(field) {
            object.insert(field.to_string(), value.clone());
        }
    }

    Ok(Value::Object(object))
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
    if let Some(existing) = guard.sessions.get(&key) {
        if let Some(object) = status.as_object_mut() {
            for field in ["presenceTimestamp", "usage"] {
                if !object.contains_key(field) {
                    if let Some(value) = existing.get(field) {
                        object.insert(field.to_string(), value.clone());
                    }
                }
            }
        }
    }
    guard.sessions.insert(key, with_session_expiry(status));
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
        ("POST", AGENT_STATUS_PATH) | ("POST", LEGACY_STATUS_PATH) => {
            match parse_body(&request.body).and_then(normalize_status) {
                Ok(mut status) => {
                    let key = session_key(&status);
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
                    if let Some(existing) = guard.sessions.get(&key) {
                        if let Some(object) = status.as_object_mut() {
                            for field in ["presenceTimestamp", "usage"] {
                                if !object.contains_key(field) {
                                    if let Some(value) = existing.get(field) {
                                        object.insert(field.to_string(), value.clone());
                                    }
                                }
                            }
                        }
                    }
                    guard.sessions.insert(key, with_session_expiry(status));
                    prune_sessions(&mut guard);
                    let response = snapshot(&guard);
                    drop(guard);
                    broadcast(&state);
                    send_json(&mut stream, 202, response);
                }
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
