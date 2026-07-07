use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use chrono::TimeZone;
use rusqlite::{params, Connection, OpenFlags};
use serde_json::{json, Value};

use crate::local_bridge;

const AGENT: &str = "workbuddy";
const USAGE_SOURCE: &str = "workbuddy-sqlite";
const DISCOVERY_INTERVAL: Duration = Duration::from_secs(3);
const DEFAULT_SESSION_STALE_MS: u64 = 5 * 60 * 60 * 1000;
const DEFAULT_LIVE_ACTIVITY_MS: u128 = 30_000;
const MAX_SESSIONS_PER_SCAN: i64 = 40;

static STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug)]
struct WorkbuddySession {
    id: String,
    cwd: Option<String>,
    title: Option<String>,
    custom_title: Option<String>,
    status: Option<String>,
    created_at: Option<u128>,
    updated_at: Option<u128>,
    last_activity_at: Option<u128>,
    source_mode: Option<String>,
    model: Option<String>,
    used: Option<u64>,
    size: Option<u64>,
    usage_updated_at: Option<u128>,
}

#[derive(Clone, Debug)]
struct SidecarSession {
    updated_at: Option<u128>,
}

#[derive(Default)]
struct SessionState {
    baseline_used: Option<u64>,
    last_payload_key: Option<String>,
    last_status: Option<String>,
    last_used: Option<u64>,
}

struct Classification {
    status: &'static str,
    phase: String,
    progress: u8,
    severity: &'static str,
    active: bool,
    reward_terminal: bool,
}

pub fn start() -> Result<(), String> {
    if STARTED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(());
    }

    thread::Builder::new()
        .name("aivatar-workbuddy-discovery".to_string())
        .spawn(discovery_loop)
        .map(|_| ())
        .map_err(|error| format!("Could not start Workbuddy discovery: {error}"))
}

fn discovery_loop() {
    let mut states = HashMap::<String, SessionState>::new();

    loop {
        if let Some(root) = workbuddy_home() {
            let sidecars = read_sidecars(&root);
            match read_sessions(&root) {
                Ok(rows) => {
                    let now = now_ms();
                    for row in rows {
                        let sidecar = sidecars.get(&row.id);
                        let state = states.entry(row.id.clone()).or_default();
                        if let Some(payload) = build_payload(&row, sidecar, state, now) {
                            let _ = submit_presence(&row, sidecar);
                            let _ = local_bridge::submit_status(payload);
                        }
                    }
                }
                Err(_) => {
                    // Workbuddy may not be installed or may be migrating its DB.
                }
            }
        }

        thread::sleep(DISCOVERY_INTERVAL);
    }
}

fn workbuddy_home() -> Option<PathBuf> {
    for key in [
        "AIVATAR_WORKBUDDY_HOME",
        "WORKBUDDY_HOME",
        "WORKBUDDY_CONFIG_DIR",
    ] {
        if let Some(path) = std::env::var_os(key).map(PathBuf::from) {
            if path.join("workbuddy.db").is_file() {
                return Some(path);
            }
        }
    }

    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)?;
    let path = home.join(".workbuddy-ai");
    path.join("workbuddy.db").is_file().then_some(path)
}

fn read_sessions(root: &std::path::Path) -> Result<Vec<WorkbuddySession>, String> {
    let db_path = root.join("workbuddy.db");
    let connection = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| error.to_string())?;
    let _ = connection.busy_timeout(Duration::from_millis(100));
    let _ = connection.execute_batch("PRAGMA query_only = ON");
    let limit = std::env::var("AIVATAR_WORKBUDDY_MAX_SESSIONS")
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(MAX_SESSIONS_PER_SCAN);
    let mut statement = connection
        .prepare(
            "
            SELECT
              s.id,
              s.cwd,
              s.title,
              s.custom_title,
              s.status,
              s.created_at,
              s.updated_at,
              s.last_activity_at,
              s.source_mode,
              s.model,
              u.used,
              u.size,
              u.updated_at AS usage_updated_at
            FROM sessions s
            LEFT JOIN session_usage u ON u.session_id = s.id
            WHERE s.id IS NOT NULL
              AND (s.deleted_at IS NULL OR s.deleted_at = 0)
              AND lower(coalesce(s.status, '')) != 'archived'
            ORDER BY coalesce(s.last_activity_at, s.updated_at, s.created_at, 0) DESC
            LIMIT ?1
            ",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map(params![limit], |row| {
            Ok(WorkbuddySession {
                id: row.get::<_, String>("id")?,
                cwd: row.get::<_, Option<String>>("cwd")?,
                title: row.get::<_, Option<String>>("title")?,
                custom_title: row.get::<_, Option<String>>("custom_title")?,
                status: row.get::<_, Option<String>>("status")?,
                created_at: row
                    .get::<_, Option<i64>>("created_at")?
                    .and_then(non_negative_u128),
                updated_at: row
                    .get::<_, Option<i64>>("updated_at")?
                    .and_then(non_negative_u128),
                last_activity_at: row
                    .get::<_, Option<i64>>("last_activity_at")?
                    .and_then(non_negative_u128),
                source_mode: row.get::<_, Option<String>>("source_mode")?,
                model: row.get::<_, Option<String>>("model")?,
                used: row
                    .get::<_, Option<i64>>("used")?
                    .and_then(non_negative_u64),
                size: row
                    .get::<_, Option<i64>>("size")?
                    .and_then(non_negative_u64),
                usage_updated_at: row
                    .get::<_, Option<i64>>("usage_updated_at")?
                    .and_then(non_negative_u128),
            })
        })
        .map_err(|error| error.to_string())?;

    let mut sessions = Vec::new();
    for row in rows.flatten() {
        if !row.id.trim().is_empty() {
            sessions.push(row);
        }
    }
    Ok(sessions)
}

fn read_sidecars(root: &std::path::Path) -> HashMap<String, SidecarSession> {
    let mut sidecars = HashMap::new();
    let sessions_dir = root.join("sessions");
    let Ok(entries) = fs::read_dir(sessions_dir) else {
        return sidecars;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = fs::read_to_string(path) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let Some(session_id) = string_field(&value, "sessionId") else {
            continue;
        };
        sidecars.insert(
            session_id,
            SidecarSession {
                updated_at: value.get("updatedAt").and_then(timestamp_ms_from_value),
            },
        );
    }

    sidecars
}

fn non_negative_u64(value: i64) -> Option<u64> {
    (value >= 0).then_some(value as u64)
}

fn non_negative_u128(value: i64) -> Option<u128> {
    (value >= 0).then_some(value as u128)
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn timestamp_ms_from_value(value: &Value) -> Option<u128> {
    if let Some(number) = value.as_u64() {
        return Some(if number > 10_000_000_000 {
            number as u128
        } else {
            number as u128 * 1000
        });
    }
    if let Some(text) = value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        if let Ok(number) = text.parse::<u64>() {
            return Some(if number > 10_000_000_000 {
                number as u128
            } else {
                number as u128 * 1000
            });
        }
        if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(text) {
            return u128::try_from(parsed.timestamp_millis()).ok();
        }
    }
    None
}

fn iso_from_ms(timestamp_ms: u128) -> String {
    let millis = i64::try_from(timestamp_ms).unwrap_or(i64::MAX);
    chrono::Utc
        .timestamp_millis_opt(millis)
        .single()
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339()
}

fn expires_from_ms(timestamp_ms: u128) -> String {
    let stale_ms = std::env::var("AIVATAR_SESSION_STALE_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(DEFAULT_SESSION_STALE_MS);
    iso_from_ms(timestamp_ms.saturating_add(stale_ms as u128))
}

fn string_field(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)?
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(String::from)
}

fn compact_text(value: Option<&str>, limit: usize) -> Option<String> {
    let clean = value?
        .replace(['\r', '\n'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if clean.is_empty() {
        return None;
    }
    Some(clean.chars().take(limit).collect())
}

fn normalized_surface(row: &WorkbuddySession) -> String {
    let clean = compact_text(row.source_mode.as_deref(), 30)
        .unwrap_or_else(|| "session".to_string())
        .to_ascii_lowercase();
    match clean.as_str() {
        "working" | "coding" | "design" => clean,
        "" => "session".to_string(),
        _ => clean,
    }
}

fn surface_label(surface: &str) -> &'static str {
    match surface {
        "working" => "Working",
        "coding" => "Coding",
        "design" => "Design",
        _ => "Session",
    }
}

fn normalized_task_status(raw_status: Option<&str>) -> &'static str {
    let clean = raw_status
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '-'], "_");
    match clean.as_str() {
        "planning" | "preparing" | "connecting" => "planning",
        "working"
        | "running"
        | "tool_start"
        | "tool_end"
        | "handoff"
        | "summarizing"
        | "waiting_team_members"
        | "model_requesting"
        | "model_streaming"
        | "model_done"
        | "tool_executing" => "working",
        "pending" | "idle" | "await_input" | "awaitinput" | "waiting_input"
        | "waiting_user_input" | "connected" => "pending",
        "completed" | "done" => "completed",
        "cancelled" | "canceled" => "cancelled",
        "failed" => "failed",
        "error" => "error",
        "terminated" => "terminated",
        "archived" => "archived",
        _ => "pending",
    }
}

fn row_activity_ms(row: &WorkbuddySession) -> u128 {
    [
        row.updated_at,
        row.last_activity_at,
        row.usage_updated_at,
        row.created_at,
    ]
    .into_iter()
    .flatten()
    .max()
    .unwrap_or(0)
}

fn latest_activity_ms(row: &WorkbuddySession, sidecar: Option<&SidecarSession>) -> u128 {
    row_activity_ms(row).max(sidecar.and_then(|sidecar| sidecar.updated_at).unwrap_or(0))
}

fn fresh_workbuddy_activity(
    row: &WorkbuddySession,
    sidecar: Option<&SidecarSession>,
    now: u128,
) -> bool {
    let latest = latest_activity_ms(row, sidecar);
    if latest == 0 {
        return false;
    }
    let window = std::env::var("AIVATAR_WORKBUDDY_LIVE_ACTIVITY_MS")
        .ok()
        .and_then(|value| value.parse::<u128>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_LIVE_ACTIVITY_MS);
    latest > now.saturating_add(60_000) || now.saturating_sub(latest) <= window
}

fn classify(row: &WorkbuddySession, sidecar: Option<&SidecarSession>, now: u128) -> Classification {
    let surface = normalized_surface(row);
    let phase_prefix = format!("workbuddy-{surface}");
    match normalized_task_status(row.status.as_deref()) {
        "planning" => Classification {
            status: "thinking",
            phase: format!("{phase_prefix}-planning"),
            progress: 25,
            severity: "info",
            active: true,
            reward_terminal: false,
        },
        "working" => Classification {
            status: "executing",
            phase: format!("{phase_prefix}-working"),
            progress: 65,
            severity: "info",
            active: true,
            reward_terminal: false,
        },
        "pending" => Classification {
            status: "waiting_for_user",
            phase: format!("{phase_prefix}-awaiting-input"),
            progress: 75,
            severity: "warning",
            active: true,
            reward_terminal: false,
        },
        "completed" => Classification {
            status: "complete",
            phase: format!("{phase_prefix}-complete"),
            progress: 100,
            severity: "info",
            active: false,
            reward_terminal: true,
        },
        "failed" | "error" | "cancelled" => Classification {
            status: "error",
            phase: format!(
                "{}-{}",
                phase_prefix,
                normalized_task_status(row.status.as_deref())
            ),
            progress: 100,
            severity: "error",
            active: false,
            reward_terminal: false,
        },
        "terminated" if fresh_workbuddy_activity(row, sidecar, now) => Classification {
            status: "thinking",
            phase: format!("{phase_prefix}-live"),
            progress: 40,
            severity: "info",
            active: true,
            reward_terminal: false,
        },
        "terminated" => Classification {
            status: "idle",
            phase: format!("{phase_prefix}-ended"),
            progress: 0,
            severity: "info",
            active: false,
            reward_terminal: false,
        },
        _ => Classification {
            status: "idle",
            phase: format!("{phase_prefix}-archived"),
            progress: 0,
            severity: "info",
            active: false,
            reward_terminal: false,
        },
    }
}

fn usage_value(row: &WorkbuddySession, scope: &str, total_tokens: Option<u64>) -> Option<Value> {
    let total = total_tokens.or(row.used)?;
    if total == 0 {
        return None;
    }
    let mut usage = json!({
        "totalTokens": total,
        "source": USAGE_SOURCE,
        "scope": scope
    });
    if scope != "context-window" {
        if let Some(object) = usage.as_object_mut() {
            object.insert("inputTokens".to_string(), json!(total));
            object.insert("cachedInputTokens".to_string(), json!(0));
            object.insert("outputTokens".to_string(), json!(0));
            object.insert("reasoningOutputTokens".to_string(), json!(0));
        }
    }
    if let (Some(used), Some(size)) = (row.used, row.size) {
        if used > 0 && size > 0 {
            if let Some(object) = usage.as_object_mut() {
                object.insert("contextTokens".to_string(), json!(used));
                object.insert("modelContextWindow".to_string(), json!(size));
            }
        }
    }
    Some(usage)
}

fn title_for_row(row: &WorkbuddySession) -> String {
    compact_text(row.custom_title.as_deref(), 90)
        .or_else(|| compact_text(row.title.as_deref(), 90))
        .or_else(|| compact_text(row.cwd.as_deref(), 90))
        .unwrap_or_else(|| "Workbuddy session".to_string())
}

fn build_payload(
    row: &WorkbuddySession,
    sidecar: Option<&SidecarSession>,
    state: &mut SessionState,
    now: u128,
) -> Option<Value> {
    let classification = classify(row, sidecar, now);
    let surface = normalized_surface(row);
    let label = surface_label(&surface);
    let title = title_for_row(row);
    let timestamp_ms = match row_activity_ms(row) {
        0 => now,
        value => value,
    };
    let raw_status =
        compact_text(row.status.as_deref(), 40).unwrap_or_else(|| "pending".to_string());
    let mut detail = vec![format!("{label} area"), format!("Workbuddy {raw_status}")];
    if let Some(model) = compact_text(row.model.as_deref(), 40) {
        detail.push(format!("model {model}"));
    }
    if let Some(cwd) = compact_text(row.cwd.as_deref(), 90) {
        detail.push(cwd);
    }

    let usage = if classification.reward_terminal {
        if let (Some(baseline), Some(used)) = (state.baseline_used, row.used) {
            if used > baseline {
                usage_value(row, "since-baseline", Some(used - baseline))
            } else {
                usage_value(row, "context-window", None)
            }
        } else {
            usage_value(row, "context-window", None)
        }
    } else {
        usage_value(row, "context-window", None)
    };

    let mut payload = json!({
        "agent": AGENT,
        "sessionId": row.id,
        "status": classification.status,
        "phase": classification.phase,
        "task": format!("{label}: {title}"),
        "summary": format!("{label}: {title}"),
        "detail": detail.join(" | "),
        "progress": classification.progress,
        "message": format!("{label}: {title}"),
        "severity": classification.severity,
        "timestamp": iso_from_ms(timestamp_ms),
        "presenceTimestamp": iso_from_ms(sidecar.and_then(|value| value.updated_at).unwrap_or(timestamp_ms)),
        "expiresAt": expires_from_ms(timestamp_ms),
        "source": USAGE_SOURCE,
        "surface": surface
    });
    if let Some(usage) = usage {
        if let Some(object) = payload.as_object_mut() {
            object.insert("usage".to_string(), usage);
        }
    }

    if classification.active {
        if row.used.is_some() && state.baseline_used.is_none() {
            state.baseline_used = row.used;
        }
    } else if classification.status == "complete"
        || classification.status == "error"
        || classification.status == "idle"
    {
        state.baseline_used = None;
    }
    state.last_status = Some(classification.status.to_string());
    state.last_used = row.used;

    let key = payload_key(&payload);
    if state.last_payload_key.as_deref() == Some(key.as_str()) {
        return None;
    }
    state.last_payload_key = Some(key);
    Some(payload)
}

fn payload_key(payload: &Value) -> String {
    format!(
        "{}|{}|{}|{}|{}|{}|{}",
        payload
            .get("sessionId")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        payload
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        payload
            .get("phase")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        payload
            .get("timestamp")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        payload
            .get("usage")
            .and_then(|usage| usage.get("scope"))
            .and_then(Value::as_str)
            .unwrap_or_default(),
        payload
            .get("usage")
            .and_then(|usage| usage.get("totalTokens"))
            .and_then(Value::as_u64)
            .unwrap_or_default(),
        payload
            .get("usage")
            .and_then(|usage| usage.get("contextTokens"))
            .and_then(Value::as_u64)
            .unwrap_or_default(),
    )
}

fn submit_presence(
    row: &WorkbuddySession,
    sidecar: Option<&SidecarSession>,
) -> Result<Value, String> {
    let timestamp_ms = sidecar
        .and_then(|value| value.updated_at)
        .unwrap_or_else(|| latest_activity_ms(row, sidecar).max(now_ms()));
    local_bridge::submit_presence(json!({
        "agent": AGENT,
        "sessionId": row.id,
        "timestamp": iso_from_ms(timestamp_ms)
    }))
}
