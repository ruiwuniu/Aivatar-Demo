use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::hash::{Hash, Hasher};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex, OnceLock,
};

use tauri::{path::BaseDirectory, Emitter, Manager, Size};

mod app_updater;
mod codex_discovery;
mod desktop_mode;
mod local_bridge;
mod save_store;
mod workbuddy_discovery;

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyntheticProfile {
    #[serde(skip)]
    root: std::path::PathBuf,
    format: String,
    identifier: String,
    data_store_identifier: [u8; 16],
}

const SYNTHETIC_NETWORK_ISOLATION: &str = r#"
(() => {
  if (window.__AIVATAR_SYNTHETIC_NETWORK_ISOLATED__) return;
  Object.defineProperty(window, '__AIVATAR_SYNTHETIC_NETWORK_ISOLATED__', {value: true});
  const blocked = value => {
    try { const url = new URL(typeof value === 'string' ? value : (value instanceof URL ? value.href : value.url), location.href); return url.port === '38987' || url.port === '38988'; }
    catch { return false; }
  };
  const denied = () => new DOMException('Live agent bridge is disabled for synthetic persistence tests', 'SecurityError');
  const audit = { blocked: 0 };
  Object.defineProperty(window, '__AIVATAR_SYNTHETIC_NETWORK_AUDIT__', {value: audit});
  const idle = {agent: 'aivatar', sessionId: 'synthetic-isolated', status: 'idle', phase: 'synthetic', timestamp: new Date().toISOString()};
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    if (!blocked(input)) return originalFetch(input, options);
    audit.blocked += 1;
    const url = String(typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url));
    const body = url.includes('/rooms') ? {rooms: [], visits: []} : url.includes('/agent-status') ? {type: 'aivatar.status.snapshot', currentStatus: idle, sessions: []} : {ok: true};
    return Promise.resolve(new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}}));
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) { if (blocked(String(url))) throw denied(); return originalOpen.call(this, method, url, ...rest); };
  class SyntheticSocket extends EventTarget {
    constructor(url) { super(); this.url = String(url); this.readyState = 0; audit.blocked += 1; queueMicrotask(() => { if (this.readyState === 3) return; this.readyState = 1; this.onopen?.(new Event('open')); this.dispatchEvent(new Event('open')); }); }
    send() {}
    close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.(new Event('close')); this.dispatchEvent(new Event('close')); }
  }
  for (const name of ['WebSocket', 'EventSource']) {
    const Original = window[name];
    if (Original) window[name] = new Proxy(Original, {construct(Target, args, NewTarget) { if (blocked(String(args[0]))) return new SyntheticSocket(args[0]); return Reflect.construct(Target, args, NewTarget); }});
  }
  const originalBeacon = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
  if (originalBeacon) navigator.sendBeacon = (url, data) => { if (blocked(String(url))) { audit.blocked += 1; return true; } return originalBeacon(url, data); };
})();
"#;

/// A debug-only test entry point. No profile override is accepted without an
/// explicitly generated marker, a separate identifier and a separate WebKit UUID.
fn synthetic_profile() -> Result<Option<SyntheticProfile>, String> {
    static PROFILE: OnceLock<Result<Option<SyntheticProfile>, String>> = OnceLock::new();
    PROFILE
        .get_or_init(|| {
            let Some(root) = std::env::var_os("AIVATAR_SYNTHETIC_ROOT") else {
                return Ok(None);
            };
            if !cfg!(debug_assertions) {
                return Err(
                    "Synthetic persistence profiles are unavailable in release builds.".into(),
                );
            }
            let root = std::path::PathBuf::from(root)
                .canonicalize()
                .map_err(|error| format!("Invalid synthetic root: {error}"))?;
            let marker = root.join("synthetic-profile.json");
            let metadata = std::fs::symlink_metadata(&marker)
                .map_err(|error| format!("Synthetic profile marker is required: {error}"))?;
            if !metadata.file_type().is_file() || metadata.len() > 16_384 {
                return Err("Synthetic profile marker is not a bounded regular file.".into());
            }
            let mut profile: SyntheticProfile =
                serde_json::from_slice(&std::fs::read(&marker).map_err(|error| error.to_string())?)
                    .map_err(|error| format!("Invalid synthetic profile marker: {error}"))?;
            if profile.format != "aivatar-synthetic-profile-v1"
                || !profile.identifier.starts_with("com.aivatar.synthetic.")
                || profile.identifier.len() > 180
                || !profile
                    .identifier
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-')
                || profile.data_store_identifier == [0; 16]
            {
                return Err(
                    "Synthetic profile must have a separate identifier and nonzero WebKit UUID."
                        .into(),
                );
            }
            #[cfg(target_os = "macos")]
            {
                let output = std::process::Command::new("/usr/bin/sw_vers")
                    .arg("-productVersion")
                    .output()
                    .map_err(|error| error.to_string())?;
                let major = String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .split('.')
                    .next()
                    .and_then(|part| part.parse::<u32>().ok())
                    .unwrap_or(0);
                if !output.status.success() || major < 14 {
                    return Err("Synthetic WebKit isolation requires macOS 14 or later.".into());
                }
            }
            profile.root = root;
            Ok(Some(profile))
        })
        .clone()
}

fn app_owned_data_directory(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    if let Some(profile) = synthetic_profile()? {
        return Ok(profile.root.join("app-data"));
    }
    app.path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))
}

fn reject_synthetic_agent_access() -> Result<(), String> {
    if synthetic_profile()?.is_some() {
        return Err("Agent integrations, discovery and the status bridge are disabled in the synthetic persistence profile.".into());
    }
    Ok(())
}

fn isolate_synthetic_window<'a>(
    builder: tauri::WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle>,
) -> Result<tauri::WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle>, String> {
    Ok(if let Some(profile) = synthetic_profile()? {
        builder
            .data_store_identifier(profile.data_store_identifier)
            .data_directory(profile.root.join("webview"))
    } else {
        builder
    })
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveStoreChanged {
    #[serde(flatten)]
    snapshot: save_store::Snapshot,
    origin_session_id: String,
}

#[tauri::command]
async fn save_store_bootstrap(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<save_store::SaveStore>>,
) -> Result<save_store::Bootstrap, String> {
    let store = Arc::clone(state.inner());
    let label = window.label().to_string();
    let generation = store.window_generation(&label)?;
    tauri::async_runtime::spawn_blocking(move || store.bootstrap_window(&label, generation))
        .await
        .map_err(|error| format!("Native storage worker failed: {error}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn save_store_migrate(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<save_store::SaveStore>>,
    session_id: String,
    entries: std::collections::BTreeMap<String, String>,
    raw_entries: std::collections::BTreeMap<String, String>,
    origin: String,
) -> Result<save_store::Snapshot, String> {
    let store = Arc::clone(state.inner());
    let label = window.label().to_string();
    let origin_session_id = session_id.clone();
    let snapshot = tauri::async_runtime::spawn_blocking(move || {
        store.migrate(
            &label,
            save_store::MigrateRequest {
                session_id,
                entries,
                raw_entries,
                origin,
            },
        )
    })
    .await
    .map_err(|error| format!("Native storage worker failed: {error}"))??;
    let _ = app.emit(
        "aivatar://store-changed",
        SaveStoreChanged {
            snapshot: snapshot.clone(),
            origin_session_id,
        },
    );
    Ok(snapshot)
}

#[tauri::command(rename_all = "camelCase")]
async fn save_store_read(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<save_store::SaveStore>>,
    session_id: String,
) -> Result<save_store::Snapshot, String> {
    let store = Arc::clone(state.inner());
    let label = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || store.read(&label, &session_id))
        .await
        .map_err(|error| format!("Native storage worker failed: {error}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn save_store_commit(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<save_store::SaveStore>>,
    session_id: String,
    operation_id: u64,
    expected: std::collections::BTreeMap<String, u64>,
    changes: std::collections::BTreeMap<String, Option<String>>,
) -> Result<save_store::CommitResult, String> {
    let store = Arc::clone(state.inner());
    let label = window.label().to_string();
    let origin_session_id = session_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        store.commit(
            &label,
            save_store::CommitRequest {
                session_id,
                operation_id,
                expected,
                changes,
            },
        )
    })
    .await
    .map_err(|error| format!("Native storage worker failed: {error}"))??;
    if result.ok {
        if let Some(snapshot) = result.snapshot.as_ref() {
            let _ = app.emit(
                "aivatar://store-changed",
                SaveStoreChanged {
                    snapshot: snapshot.clone(),
                    origin_session_id,
                },
            );
        }
    }
    Ok(result)
}

#[derive(Default)]
struct SyntheticHarnessState {
    reports: Mutex<HashMap<String, serde_json::Value>>,
}

fn synthetic_harness_phase() -> Result<Option<String>, String> {
    let phase = std::env::var("AIVATAR_SYNTHETIC_PHASE").ok();
    if let Some(value) = phase.as_deref() {
        if !["initial", "restart", "crash", "after-crash"].contains(&value) {
            return Err("Unknown synthetic persistence phase.".into());
        }
    }
    Ok(phase)
}

#[tauri::command(rename_all = "camelCase")]
async fn save_store_synthetic_control(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    action: String,
    peer: Option<String>,
    report: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let profile = synthetic_profile()?
        .ok_or("Synthetic control is disabled outside a marked debug profile")?;
    let target = match peer.as_deref() {
        Some("alpha") => "save-slot-synthetic-alpha",
        Some("beta") => "save-slot-synthetic-beta",
        None => window.label(),
        _ => return Err("Invalid synthetic peer".into()),
    };
    match action.as_str() {
        "open-peer" => {
            if target == window.label() {
                return Err("A synthetic peer name is required".into());
            }
            if app.get_webview_window(target).is_none() {
                let role = peer.as_deref().ok_or("Missing peer")?;
                let phase = synthetic_harness_phase()?.unwrap_or_else(|| "initial".into());
                let url = format!("./?nativeStoreHarness=peer&role={role}&phase={phase}");
                let peer_window = isolate_synthetic_window(tauri::WebviewWindowBuilder::new(
                    &app,
                    target,
                    tauri::WebviewUrl::App(std::path::PathBuf::from(url)),
                ))?
                .title(format!("Aivatar synthetic store — {role}"))
                .inner_size(600.0, 420.0)
                .additional_browser_args(WEBVIEW2_BROWSER_ARGS)
                .build()
                .map_err(|error| error.to_string())?;
                attach_save_before_close_handler(peer_window);
            }
            Ok(serde_json::json!({"label":target}))
        }
        "start-work" => {
            app.emit_to(target, "aivatar://synthetic-work", ())
                .map_err(|error| error.to_string())?;
            Ok(serde_json::Value::Null)
        }
        "request-close" => {
            app.get_webview_window(target)
                .ok_or("Synthetic window is absent")?
                .close()
                .map_err(|error| error.to_string())?;
            Ok(serde_json::Value::Null)
        }
        "status" => {
            let reports = app
                .state::<SyntheticHarnessState>()
                .reports
                .lock()
                .map_err(|_| "Synthetic reports lock was poisoned")?
                .clone();
            let windows: Vec<String> = app.webview_windows().keys().cloned().collect();
            Ok(serde_json::json!({"reports":reports,"windows":windows}))
        }
        "report" => {
            let report = report.ok_or("Missing synthetic report")?;
            let encoded = serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?;
            if encoded.len() > 1024 * 1024 {
                return Err("Synthetic report exceeds 1 MiB".into());
            }
            let label = window.label().to_string();
            app.state::<SyntheticHarnessState>()
                .reports
                .lock()
                .map_err(|_| "Synthetic reports lock was poisoned")?
                .insert(label.clone(), report);
            let phase = synthetic_harness_phase()?.unwrap_or_else(|| "manual".into());
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|error| error.to_string())?
                .as_nanos();
            let directory = profile.root.join("reports");
            let name = format!(
                "{}-{phase}-{stamp}.json",
                safe_social_room_memory_key(&label)
            );
            tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
                use std::io::Write;
                std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
                let mut file = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(directory.join(name))
                    .map_err(|error| error.to_string())?;
                file.write_all(&encoded)
                    .map_err(|error| error.to_string())?;
                file.sync_all().map_err(|error| error.to_string())
            })
            .await
            .map_err(|error| error.to_string())??;
            Ok(serde_json::Value::Null)
        }
        #[cfg(debug_assertions)]
        "diagnostics" => {
            let store = Arc::clone(app.state::<Arc<save_store::SaveStore>>().inner());
            tauri::async_runtime::spawn_blocking(move || store.synthetic_diagnostics())
                .await.map_err(|error| error.to_string())?
        }
        "crash" => {
            std::process::exit(74);
        }
        _ => Err("Unknown synthetic control action".into()),
    }
}

#[derive(serde::Serialize)]
struct BridgeStartResult {
    status: String,
    message: String,
}

#[derive(serde::Deserialize)]
struct AgentCliLaunchRequest {
    agent: String,
    cwd: String,
    args: Option<String>,
    allow_new_session: Option<bool>,
}

#[derive(serde::Serialize)]
struct AgentCliLaunchResult {
    status: String,
    message: String,
}

#[derive(serde::Deserialize)]
struct TaskAgentLaunchRequest {
    agent: String,
    cwd: String,
    args: Option<String>,
    task_path: String,
    session_id: String,
}

#[derive(serde::Serialize)]
struct TaskAgentLaunchResult {
    status: String,
    message: String,
    session_id: String,
}

#[derive(serde::Deserialize)]
struct AgentIntegrationRequest {
    agent: String,
}

#[derive(serde::Serialize)]
struct AgentIntegrationStatus {
    agent: String,
    label: String,
    detected: bool,
    enabled: bool,
    cli_available: bool,
    needs_restart: bool,
    detail: String,
    config_path: Option<String>,
    connector_path: Option<String>,
    cli_path: Option<String>,
}

#[derive(serde::Deserialize)]
struct SaveSlotWindowRequest {
    slot_id: String,
    avatar_name: Option<String>,
}

#[derive(serde::Serialize)]
struct SaveSlotWindowResult {
    label: String,
}

#[derive(serde::Deserialize)]
struct CardRoomWindowRequest {
    host_slot_id: Option<String>,
}

#[derive(serde::Serialize)]
struct CardRoomWindowResult {
    label: String,
}

#[derive(serde::Deserialize)]
struct ParkWindowRequest {
    host_slot_id: Option<String>,
}

#[derive(serde::Serialize)]
struct ParkWindowResult {
    label: String,
}

#[derive(Default)]
struct ParkProfileWindowState {
    hidden_by: Mutex<Option<String>>,
}

#[derive(Default)]
struct CloseSaveState {
    next_request_id: AtomicU64,
    windows: Mutex<CloseSaveWindows>,
}

#[derive(Default)]
struct CloseSaveWindows {
    pending: HashMap<String, u64>,
    approved: HashSet<String>,
    pending_exit_code: Option<Option<i32>>,
    replaying_exit: bool,
    persistent: HashSet<String>,
    updating: bool,
    opening_windows: usize,
}

impl CloseSaveWindows {
    fn can_start_update(&self) -> bool {
        !self.updating
            && self.opening_windows == 0
            && self.pending.is_empty()
            && self.approved.is_empty()
            && self.pending_exit_code.is_none()
            && !self.replaying_exit
    }
}

// Reserve window creation before dispatching native UI work. Installation
// takes the same short lock, so it cannot miss a window still being created.
struct WindowOpenGuard(tauri::AppHandle);

impl WindowOpenGuard {
    fn acquire(app: &tauri::AppHandle) -> Result<Self, String> {
        let close = app.state::<CloseSaveState>();
        let mut windows = close.windows.lock()
            .map_err(|_| "Could not lock window state.".to_string())?;
        if windows.updating {
            return Err("Please wait until the application update has finished.".into());
        }
        windows.opening_windows += 1;
        Ok(Self(app.clone()))
    }
}

impl Drop for WindowOpenGuard {
    fn drop(&mut self) {
        if let Ok(mut windows) = self.0.state::<CloseSaveState>().windows.lock() {
            windows.opening_windows = windows.opening_windows.saturating_sub(1);
        }
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveBeforeCloseRequest {
    request_id: u64,
}

const MAX_TASK_PROMPT_CHARS: usize = 24_000;
const CLOSE_SAVE_TIMEOUT_MS: u64 = 15_000;
// Wry replaces its default WebView2 arguments when custom arguments are set.
// Keep those defaults here, and use this exact value for every shared-profile window.
const WEBVIEW2_BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required --disk-cache-size=134217728";

fn hash_value(value: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

fn save_slot_window_label(slot_id: &str) -> String {
    let sanitized: String = slot_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect();
    let compact = sanitized.trim_matches('-');
    let prefix: String = compact.chars().take(40).collect();
    let prefix = if prefix.is_empty() { "slot" } else { &prefix };

    format!("save-slot-{prefix}-{:016x}", hash_value(slot_id))
}

fn card_room_window_label(host_slot_id: &str) -> String {
    let sanitized: String = host_slot_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect();
    let compact = sanitized.trim_matches('-');
    let prefix: String = compact.chars().take(34).collect();
    let prefix = if prefix.is_empty() { "table" } else { &prefix };

    format!("card-room-{prefix}-{:016x}", hash_value(host_slot_id))
}

fn park_window_label(host_slot_id: &str) -> String {
    let sanitized: String = host_slot_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect();
    let compact = sanitized.trim_matches('-');
    let prefix: String = compact.chars().take(36).collect();
    let prefix = if prefix.is_empty() { "meadow" } else { &prefix };
    format!("park-{prefix}-{:016x}", hash_value(host_slot_id))
}

fn park_developer_window_label(host_slot_id: &str) -> String {
    format!("park-developer-{:016x}", hash_value(host_slot_id))
}

fn park_animation_preview_window_label(host_slot_id: &str) -> String {
    format!("park-animation-preview-{:016x}", hash_value(host_slot_id))
}

fn url_component(value: &str) -> String {
    let mut encoded = String::new();

    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char)
            }
            _ => {
                let _ = write!(encoded, "%{byte:02X}");
            }
        }
    }

    encoded
}

fn attach_store_window_lifecycle(window: &tauri::WebviewWindow) {
    let store = Arc::clone(window.state::<Arc<save_store::SaveStore>>().inner());
    let label = window.label().to_string();
    let generation = store
        .register_window(&label)
        .expect("could not register native window lifetime");
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            // Expire authorization synchronously using a short metadata-only lock.
            // Deferred cleanup carries this exact generation, never just a label.
            let _ = store.expire_window(&label, generation);
            let store = Arc::clone(&store);
            let label = label.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let _ = store.end_window_generation(&label, generation);
            });
        }
    });
}

fn attach_save_before_close_handler(window: tauri::WebviewWindow) {
    attach_store_window_lifecycle(&window);
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    let window_for_event = window.clone();
    if let Ok(mut windows) = app.state::<CloseSaveState>().windows.lock() {
        windows.persistent.insert(label.clone());
    }

    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            let close_state = app.state::<CloseSaveState>();
            let mut windows = match close_state.windows.lock() {
                Ok(windows) => windows,
                Err(_) => {
                    api.prevent_close();
                    return;
                }
            };
            if windows.updating {
                api.prevent_close();
                return;
            }
            // If saving fails or times out, leave an ordinary, reachable room window.
            if desktop_mode::is_active(&app, &label) {
                desktop_mode::restore_async(window_for_event.clone(), "close-requested");
            }
            if windows.approved.remove(&label) {
                return;
            }

            api.prevent_close();
            if windows.pending.contains_key(&label) {
                return;
            }

            let request_id = close_state
                .next_request_id
                .fetch_add(1, Ordering::Relaxed)
                .wrapping_add(1);
            windows.pending.insert(label.clone(), request_id);
            drop(windows);

            if window_for_event
                .emit_to(
                    label.as_str(),
                    "aivatar://save-before-close",
                    SaveBeforeCloseRequest { request_id },
                )
                .is_err()
            {
                if let Ok(mut windows) = close_state.windows.lock() {
                    windows.pending.remove(&label);
                    windows.pending_exit_code = None;
                }
                return;
            }

            let app_for_timeout = app.clone();
            let label_for_timeout = label.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(CLOSE_SAVE_TIMEOUT_MS));
                let close_state = app_for_timeout.state::<CloseSaveState>();
                if let Ok(mut windows) = close_state.windows.lock() {
                    if windows.pending.get(&label_for_timeout) == Some(&request_id) {
                        // Fail closed: a renderer that did not confirm its save must stay open.
                        // Clearing only the stale request lets a later close attempt retry.
                        windows.pending.remove(&label_for_timeout);
                        windows.pending_exit_code = None;
                    }
                };
            });
        }
        tauri::WindowEvent::Destroyed => {
            desktop_mode::forget_window(&app, &label);
            if let Ok(mut windows) = app.state::<CloseSaveState>().windows.lock() {
                windows.pending.remove(&label);
                windows.approved.remove(&label);
                windows.persistent.remove(&label);
            }
            app_updater::window_destroyed(&app, &label);
        }
        _ => {}
    });
}

#[tauri::command]
fn confirm_close_after_save(
    window: tauri::WebviewWindow,
    request_id: u64,
    ok: bool,
) -> Result<(), String> {
    let label = window.label().to_string();
    let app = window.app_handle();
    let close_state = app.state::<CloseSaveState>();
    let mut windows = close_state
        .windows
        .lock()
        .map_err(|_| "Could not lock the close-save state.".to_string())?;

    if windows.pending.get(&label) != Some(&request_id) {
        return Err("The close-save request is no longer active.".to_string());
    }

    windows.pending.remove(&label);
    if !ok {
        windows.pending_exit_code = None;
        return Ok(());
    }

    windows.approved.insert(label.clone());
    drop(windows);
    if let Err(error) = window.close() {
        if let Ok(mut windows) = close_state.windows.lock() {
            windows.approved.remove(&label);
            windows.pending_exit_code = None;
        }
        return Err(format!("Could not close the saved window: {error}"));
    }
    Ok(())
}

fn attach_main_window_restore_handler(window: tauri::WebviewWindow, app: tauri::AppHandle) {
    let park_window_label = window.label().to_string();
    window.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
        ) {
            let _ = set_main_window_visibility_for_park_owner(&app, &park_window_label, true);
        }
    });
}

fn set_main_window_visibility_for_park_owner(
    app: &tauri::AppHandle,
    owner_label: &str,
    visible: bool,
) -> Result<(), String> {
    if !visible && desktop_mode::is_active(app, "main") {
        return Err("Return the avatar to its room before hiding it for the park.".into());
    }
    let profile_state = app.state::<ParkProfileWindowState>();
    let mut hidden_by = profile_state
        .hidden_by
        .lock()
        .map_err(|_| "Could not lock the park profile window state.".to_string())?;
    if !visible && app.get_webview_window(owner_label).is_none() {
        return Err("The park window is no longer available.".to_string());
    }
    if hidden_by.as_ref().is_some_and(|owner| owner != owner_label) {
        return Err("Another park window owns the main-window profiling state.".to_string());
    }
    if !visible && hidden_by.as_deref() == Some(owner_label) {
        return Ok(());
    }
    if visible && hidden_by.is_none() {
        return Ok(());
    }
    let main_window = app
        .get_webview_window("main")
        .ok_or_else(|| "Could not find the main window.".to_string())?;
    if visible {
        main_window
            .show()
            .map_err(|error| format!("Could not show the main window: {error}"))?;
        *hidden_by = None;
    } else {
        main_window
            .hide()
            .map_err(|error| format!("Could not hide the main window: {error}"))?;
        *hidden_by = Some(owner_label.to_string());
    }
    Ok(())
}

fn project_root() -> Result<std::path::PathBuf, String> {
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(std::path::Path::to_path_buf)
        .ok_or_else(|| "Could not resolve Aivatar project root.".to_string())
}

fn development_project_root() -> Option<std::path::PathBuf> {
    let root = project_root().ok()?;
    let package_json = root.join("package.json");
    let bridge_script = root.join("scripts").join("codex-status-bridge.mjs");
    package_json.is_file().then_some(())?;
    bridge_script.is_file().then_some(())?;
    Some(root)
}

fn connector_root(app: Option<&tauri::AppHandle>) -> Option<std::path::PathBuf> {
    if let Some(app) = app {
        let mut candidates = Vec::new();
        if let Ok(path) = app
            .path()
            .resolve("../plugins/aivatar-session-bridge", BaseDirectory::Resource)
        {
            candidates.push(path);
        }
        if let Ok(resource_dir) = app.path().resource_dir() {
            candidates.push(
                resource_dir
                    .join("_up_")
                    .join("plugins")
                    .join("aivatar-session-bridge"),
            );
            candidates.push(resource_dir.join("plugins").join("aivatar-session-bridge"));
            candidates.push(resource_dir.join("aivatar-session-bridge"));
        }

        if let Some(path) = candidates
            .into_iter()
            .find(|path| path.join("scripts").join("aivatar-heartbeat.mjs").is_file())
        {
            return Some(path);
        }
    }

    if cfg!(debug_assertions) || app.is_none() {
        if let Some(path) =
            std::env::var_os("AIVATAR_SESSION_PLUGIN_ROOT").map(std::path::PathBuf::from)
        {
            if path.join("scripts").join("aivatar-heartbeat.mjs").is_file() {
                return Some(path);
            }
        }

        if let Ok(root) = project_root() {
            let path = root.join("plugins").join("aivatar-session-bridge");
            if path.join("scripts").join("aivatar-heartbeat.mjs").is_file() {
                return Some(path);
            }
        }
    }

    None
}

fn scripts_root(app: Option<&tauri::AppHandle>) -> Option<std::path::PathBuf> {
    if let Some(app) = app {
        let mut candidates = Vec::new();
        if let Ok(path) = app.path().resolve("../scripts", BaseDirectory::Resource) {
            candidates.push(path);
        }
        if let Ok(resource_dir) = app.path().resource_dir() {
            candidates.push(resource_dir.join("_up_").join("scripts"));
            candidates.push(resource_dir.join("scripts"));
        }

        if let Some(path) = candidates
            .into_iter()
            .find(|path| path.join("aivatar-connected-run.mjs").is_file())
        {
            return Some(path);
        }
    }

    if cfg!(debug_assertions) || app.is_none() {
        if let Some(path) = std::env::var_os("AIVATAR_SCRIPTS_ROOT").map(std::path::PathBuf::from) {
            if path.join("aivatar-connected-run.mjs").is_file() {
                return Some(path);
            }
        }

        if let Some(root) = development_project_root() {
            let path = root.join("scripts");
            if path.join("aivatar-connected-run.mjs").is_file() {
                return Some(path);
            }
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn windows_command_fallback(command: &str) -> Option<std::path::PathBuf> {
    if command.eq_ignore_ascii_case("opencode") {
        let path = std::env::var_os("LOCALAPPDATA")
            .map(std::path::PathBuf::from)?
            .join("opencode")
            .join("opencode-cli.exe");
        return path.is_file().then_some(path);
    }

    None
}

#[cfg(target_os = "windows")]
fn resolve_command(command: &str) -> Option<std::path::PathBuf> {
    let mut process = std::process::Command::new("where.exe");
    process
        .arg(command)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());

    use std::os::windows::process::CommandExt;
    process.creation_flags(0x08000000);

    let output = process.output().ok()?;

    if !output.status.success() {
        return windows_command_fallback(command);
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(std::path::PathBuf::from)
        .find(|path| path.is_file())
        .or_else(|| windows_command_fallback(command))
}

#[cfg(not(target_os = "windows"))]
fn resolve_command(command: &str) -> Option<std::path::PathBuf> {
    let command_path = std::path::PathBuf::from(command);
    if command_path.components().count() > 1 && command_path.is_file() {
        return Some(command_path);
    }

    let mut search_dirs: Vec<std::path::PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();

    search_dirs.extend([
        std::path::PathBuf::from("/opt/homebrew/bin"),
        std::path::PathBuf::from("/usr/local/bin"),
        std::path::PathBuf::from("/usr/bin"),
        std::path::PathBuf::from("/bin"),
        std::path::PathBuf::from("/usr/sbin"),
        std::path::PathBuf::from("/sbin"),
    ]);

    if let Some(home) = std::env::var_os("HOME").map(std::path::PathBuf::from) {
        search_dirs.push(home.join(".local").join("bin"));
        search_dirs.push(home.join(".cargo").join("bin"));
    }

    search_dirs
        .into_iter()
        .map(|dir| dir.join(command))
        .find(|path| path.is_file())
}

fn user_home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
}

fn path_text(path: &std::path::Path) -> String {
    path.to_string_lossy().to_string()
}

fn opencode_plugin_path() -> Option<std::path::PathBuf> {
    Some(
        user_home_dir()?
            .join(".config")
            .join("opencode")
            .join("plugins")
            .join("aivatar-opencode-plugin.js"),
    )
}

fn claude_settings_path() -> Option<std::path::PathBuf> {
    Some(user_home_dir()?.join(".claude").join("settings.json"))
}

#[cfg(target_os = "windows")]
fn claude_wrapper_paths() -> Option<(std::path::PathBuf, std::path::PathBuf)> {
    let dir = user_home_dir()?.join(".claude");
    Some((
        dir.join("aivatar-hook.ps1"),
        dir.join("aivatar-statusline.ps1"),
    ))
}

#[cfg(not(target_os = "windows"))]
fn claude_wrapper_paths() -> Option<(std::path::PathBuf, std::path::PathBuf)> {
    let dir = user_home_dir()?.join(".claude");
    Some((
        dir.join("aivatar-hook.sh"),
        dir.join("aivatar-statusline.sh"),
    ))
}

fn json_contains_aivatar(value: &serde_json::Value) -> bool {
    value.to_string().to_ascii_lowercase().contains("aivatar")
}

const CLAUDE_REQUIRED_ORDINARY_EVENTS: &[&str] = &[
    "SessionStart",
    "Setup",
    "InstructionsLoaded",
    "UserPromptSubmit",
    "UserPromptExpansion",
    "MessageDisplay",
    "Notification",
    "PostToolBatch",
    "SubagentStart",
    "SubagentStop",
    "TaskCreated",
    "TaskCompleted",
    "PreCompact",
    "PostCompact",
    "Elicitation",
    "ElicitationResult",
    "ConfigChange",
    "CwdChanged",
    "Stop",
    "TeammateIdle",
    "StopFailure",
    "SessionEnd",
];

const CLAUDE_REQUIRED_TOOL_EVENTS: &[&str] = &[
    "PreToolUse",
    "PermissionRequest",
    "PermissionDenied",
    "PostToolUse",
    "PostToolUseFailure",
];

const MAIN_WINDOW_DEFAULT_WIDTH: f64 = 760.0;
const MAIN_WINDOW_DEFAULT_HEIGHT: f64 = 520.0;
const MAIN_WINDOW_MIN_WIDTH: f64 = 720.0;
const MAIN_WINDOW_MIN_HEIGHT: f64 = 500.0;

fn main_window_min_size(width: f64) -> Size {
    Size::Logical(tauri::LogicalSize {
        width,
        height: MAIN_WINDOW_MIN_HEIGHT,
    })
}

fn main_window_size(width: f64, height: f64) -> Size {
    Size::Logical(tauri::LogicalSize { width, height })
}

fn normalize_main_window_size(window: &tauri::WebviewWindow) {
    let _ = window.set_maximizable(false);
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    }
    let _ = window.set_min_size(Some(main_window_min_size(MAIN_WINDOW_MIN_WIDTH)));
    let _ = window.set_size(main_window_size(
        MAIN_WINDOW_DEFAULT_WIDTH,
        MAIN_WINDOW_DEFAULT_HEIGHT,
    ));
}

fn claude_hook_event_has_aivatar(settings: &serde_json::Value, event: &str) -> bool {
    settings
        .get("hooks")
        .and_then(|hooks| hooks.get(event))
        .is_some_and(json_contains_aivatar)
}

fn claude_hooks_complete(settings: &serde_json::Value) -> bool {
    CLAUDE_REQUIRED_ORDINARY_EVENTS
        .iter()
        .chain(CLAUDE_REQUIRED_TOOL_EVENTS.iter())
        .all(|event| claude_hook_event_has_aivatar(settings, event))
        && settings
            .get("statusLine")
            .is_some_and(json_contains_aivatar)
}

fn read_json_file(path: &std::path::Path) -> serde_json::Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

fn atomic_write_text(path: &std::path::Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(path, text).map_err(|error| error.to_string())
}

#[cfg(not(target_os = "windows"))]
fn make_executable(path: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = std::fs::metadata(path)
        .map_err(|error| error.to_string())?
        .permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(path, permissions).map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn make_executable(_path: &std::path::Path) -> Result<(), String> {
    Ok(())
}

fn remove_existing_aivatar_hook_entries(entries: &mut Vec<serde_json::Value>) {
    entries.retain(|entry| !json_contains_aivatar(entry));
}

fn upsert_claude_hook(
    settings: &mut serde_json::Value,
    event: &str,
    group: serde_json::Value,
) -> Result<(), String> {
    let root = settings
        .as_object_mut()
        .ok_or_else(|| "Claude settings must be a JSON object.".to_string())?;
    let hooks = root
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or_else(|| "Claude settings hooks must be a JSON object.".to_string())?;
    let entry = hooks
        .entry(event.to_string())
        .or_insert_with(|| serde_json::json!([]));
    if !entry.is_array() {
        *entry = serde_json::json!([]);
    }
    let entries = entry
        .as_array_mut()
        .ok_or_else(|| "Claude hook entry must be an array.".to_string())?;
    remove_existing_aivatar_hook_entries(entries);
    entries.push(group);
    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_shell_path_quote(path: &std::path::Path) -> String {
    format!(
        "\"{}\"",
        path_text(path).replace('\\', "/").replace('"', "")
    )
}

#[cfg(target_os = "windows")]
fn claude_hook_handler(path: &std::path::Path) -> serde_json::Value {
    serde_json::json!({
        "type": "command",
        "command": "powershell",
        "args": [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            path_text(path),
            "-Mode",
            "hook"
        ],
        "timeout": 10
    })
}

#[cfg(not(target_os = "windows"))]
fn claude_hook_handler(path: &std::path::Path) -> serde_json::Value {
    serde_json::json!({
        "type": "command",
        "command": "/bin/sh",
        "args": [path_text(path), "hook"],
        "timeout": 10
    })
}

#[cfg(target_os = "windows")]
fn claude_status_line_command(path: &std::path::Path) -> String {
    format!(
        "powershell -NoProfile -ExecutionPolicy Bypass -File {} -Mode status-line",
        windows_shell_path_quote(path)
    )
}

#[cfg(not(target_os = "windows"))]
fn claude_status_line_command(path: &std::path::Path) -> String {
    format!(
        "/bin/sh '{}' status-line",
        path_text(path).replace('\'', "'\\''")
    )
}

#[cfg(target_os = "windows")]
fn claude_wrapper_content(default_mode: &str) -> String {
    format!(
        r#"$ErrorActionPreference = "SilentlyContinue"
param([string]$Mode = "{default_mode}")
$body = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($body)) {{ $body = "{{}}" }}
$target = "http://127.0.0.1:38988/agent-hooks/claude-code"
if ($Mode -eq "status-line") {{ $target = "http://127.0.0.1:38988/agent-hooks/claude-code/status-line" }}
try {{
  $response = Invoke-WebRequest -Uri $target -Method Post -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 2
  if ($Mode -eq "status-line") {{
    try {{
      $parsed = $response.Content | ConvertFrom-Json
      if ($parsed.label) {{ [Console]::Write($parsed.label) }} else {{ [Console]::Write("Aivatar linked") }}
    }} catch {{ [Console]::Write("Aivatar linked") }}
  }}
}} catch {{
  if ($Mode -eq "status-line") {{ [Console]::Write("Aivatar offline") }}
}}
"#
    )
}

#[cfg(not(target_os = "windows"))]
fn claude_wrapper_content(default_mode: &str) -> String {
    format!(
        r#"#!/bin/sh
mode="${{1:-{default_mode}}}"
body="$(cat)"
if [ -z "$body" ]; then body="{{}}"; fi
target="http://127.0.0.1:38988/agent-hooks/claude-code"
if [ "$mode" = "status-line" ]; then
  target="http://127.0.0.1:38988/agent-hooks/claude-code/status-line"
fi
response="$(/usr/bin/curl -fsS -m 2 -H 'content-type: application/json' --data-binary "$body" "$target" 2>/dev/null)"
if [ "$mode" = "status-line" ]; then
  label="$(printf '%s' "$response" | /usr/bin/sed -n 's/.*"label"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [ -n "$label" ]; then
    printf '%s' "$label"
  else
    printf '%s' "Aivatar linked"
  fi
fi
"#
    )
}

fn enable_claude_code_integration() -> Result<(), String> {
    let settings_path =
        claude_settings_path().ok_or_else(|| "Could not resolve ~/.claude.".to_string())?;
    let (hook_path, status_line_path) = claude_wrapper_paths()
        .ok_or_else(|| "Could not resolve Claude wrapper path.".to_string())?;
    atomic_write_text(&hook_path, &claude_wrapper_content("hook"))?;
    atomic_write_text(&status_line_path, &claude_wrapper_content("status-line"))?;
    make_executable(&hook_path)?;
    make_executable(&status_line_path)?;

    let mut settings = read_json_file(&settings_path);
    if !settings.is_object() {
        settings = serde_json::json!({});
    }
    if let Some(root) = settings.as_object_mut() {
        let env = root
            .entry("env")
            .or_insert_with(|| serde_json::json!({}))
            .as_object_mut()
            .ok_or_else(|| "Claude settings env must be a JSON object.".to_string())?;
        env.insert(
            "AIVATAR_LEARNING_ENABLED".to_string(),
            serde_json::json!("1"),
        );
        env.insert(
            "AIVATAR_LEARNING_PROVIDER".to_string(),
            serde_json::json!("claude-code"),
        );
    }

    let ordinary = serde_json::json!({ "hooks": [claude_hook_handler(&hook_path)] });
    let tool = serde_json::json!({
        "matcher": "*",
        "hooks": [claude_hook_handler(&hook_path)]
    });
    for event in [
        "SessionStart",
        "Setup",
        "InstructionsLoaded",
        "UserPromptSubmit",
        "UserPromptExpansion",
        "MessageDisplay",
        "Notification",
        "PostToolBatch",
        "SubagentStart",
        "SubagentStop",
        "TaskCreated",
        "TaskCompleted",
        "PreCompact",
        "PostCompact",
        "Elicitation",
        "ElicitationResult",
        "ConfigChange",
        "CwdChanged",
        "Stop",
        "TeammateIdle",
        "StopFailure",
        "SessionEnd",
    ] {
        upsert_claude_hook(&mut settings, event, ordinary.clone())?;
    }
    for event in [
        "PreToolUse",
        "PermissionRequest",
        "PermissionDenied",
        "PostToolUse",
        "PostToolUseFailure",
    ] {
        upsert_claude_hook(&mut settings, event, tool.clone())?;
    }
    if let Some(root) = settings.as_object_mut() {
        root.insert(
            "statusLine".to_string(),
            serde_json::json!({
                "type": "command",
                "command": claude_status_line_command(&status_line_path),
                "refreshInterval": 5
            }),
        );
    }
    atomic_write_text(
        &settings_path,
        &serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?,
    )
}

fn enable_opencode_integration(app: Option<&tauri::AppHandle>) -> Result<(), String> {
    let target = opencode_plugin_path()
        .ok_or_else(|| "Could not resolve opencode plugin path.".to_string())?;
    let scripts = scripts_root(app)
        .ok_or_else(|| "Aivatar scripts were not found in the app resources.".to_string())?;
    let source = scripts.join("aivatar-opencode-plugin.mjs");
    let mut content = std::fs::read_to_string(&source)
        .map_err(|error| format!("Could not read opencode plugin: {error}"))?;
    let learning_script = scripts.join("aivatar-learning-worker.mjs");
    let learning_script_value = if learning_script.is_file() {
        path_text(&learning_script)
    } else {
        String::new()
    };
    let node_value = resolve_command("node")
        .map(|path| path_text(&path))
        .unwrap_or_default();
    content = content.replace(
        "\"__AIVATAR_LEARNING_SCRIPT__\"",
        &serde_json::to_string(&learning_script_value).map_err(|error| error.to_string())?,
    );
    content = content.replace(
        "\"__AIVATAR_NODE_COMMAND__\"",
        &serde_json::to_string(&node_value).map_err(|error| error.to_string())?,
    );
    atomic_write_text(&target, &content)
}

fn claude_code_integration_status() -> AgentIntegrationStatus {
    let settings_path = claude_settings_path();
    let settings = settings_path
        .as_deref()
        .map(read_json_file)
        .unwrap_or_else(|| serde_json::json!({}));
    let cli_path = resolve_command("claude");
    let has_aivatar_config = json_contains_aivatar(&settings);
    let enabled = claude_hooks_complete(&settings);
    let detected = cli_path.is_some()
        || settings_path
            .as_ref()
            .and_then(|path| path.parent().map(std::path::Path::is_dir))
            .unwrap_or(false);
    AgentIntegrationStatus {
        agent: "claude-code".to_string(),
        label: "Claude Code".to_string(),
        detected,
        enabled,
        cli_available: cli_path.is_some(),
        needs_restart: has_aivatar_config && !enabled,
        detail: if enabled {
            "Hooks/statusLine installed for Claude Code, Chat, and Cowork sessions.".to_string()
        } else if has_aivatar_config {
            "Aivatar Claude hooks are incomplete; repair to restore Chat and Cowork tracking."
                .to_string()
        } else if detected {
            "Claude Code detected; enable Aivatar hooks from this app.".to_string()
        } else {
            "Claude Code was not found yet.".to_string()
        },
        config_path: settings_path.as_ref().map(|path| path_text(path)),
        connector_path: claude_wrapper_paths().map(|(path, _)| path_text(&path)),
        cli_path: cli_path.as_ref().map(|path| path_text(path)),
    }
}

fn opencode_integration_status() -> AgentIntegrationStatus {
    let plugin_path = opencode_plugin_path();
    let cli_path = resolve_command("opencode");
    #[cfg(target_os = "windows")]
    let desktop_detected = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .map(|path| {
            path.join("Programs")
                .join("@opencode-aidesktop")
                .join("OpenCode.exe")
                .is_file()
        })
        .unwrap_or(false);
    #[cfg(target_os = "macos")]
    let desktop_detected = [
        std::path::PathBuf::from("/Applications/OpenCode.app"),
        std::path::PathBuf::from("/Applications/opencode.app"),
    ]
    .iter()
    .any(|path| path.exists());
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let desktop_detected = false;
    let enabled = plugin_path.as_ref().is_some_and(|path| path.is_file());
    let detected = desktop_detected || cli_path.is_some() || enabled;
    AgentIntegrationStatus {
        agent: "opencode".to_string(),
        label: "opencode".to_string(),
        detected,
        enabled,
        cli_available: cli_path.is_some(),
        needs_restart: false,
        detail: if enabled {
            "Plugin installed for opencode Desktop/TUI.".to_string()
        } else if detected {
            "opencode detected; enable the Aivatar plugin from this app.".to_string()
        } else {
            "opencode was not found yet.".to_string()
        },
        config_path: user_home_dir().map(|path| {
            path.join(".config")
                .join("opencode")
                .to_string_lossy()
                .to_string()
        }),
        connector_path: plugin_path.as_ref().map(|path| path_text(path)),
        cli_path: cli_path.as_ref().map(|path| path_text(path)),
    }
}

#[tauri::command]
fn get_agent_integrations() -> Result<Vec<AgentIntegrationStatus>, String> {
    if synthetic_profile()?.is_some() {
        return Ok(Vec::new());
    }
    Ok(vec![
        claude_code_integration_status(),
        opencode_integration_status(),
    ])
}

#[tauri::command]
fn enable_agent_integration(
    app: tauri::AppHandle,
    request: AgentIntegrationRequest,
) -> Result<AgentIntegrationStatus, String> {
    reject_synthetic_agent_access()?;
    match request.agent.as_str() {
        "claude-code" => {
            enable_claude_code_integration()?;
            Ok(claude_code_integration_status())
        }
        "opencode" => {
            enable_opencode_integration(Some(&app))?;
            Ok(opencode_integration_status())
        }
        _ => Err("Unsupported agent integration.".to_string()),
    }
}

fn is_status_bridge_running() -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], 38988)),
        std::time::Duration::from_millis(350),
    )
    .is_ok()
}

fn start_status_bridge_inner(app: Option<&tauri::AppHandle>) -> Result<BridgeStartResult, String> {
    reject_synthetic_agent_access()?;
    let connector = connector_root(app);
    let learning_script = scripts_root(app).map(|path| path.join("aivatar-learning-worker.mjs"));
    if is_status_bridge_running() {
        let _ = codex_discovery::start(learning_script);
        let _ = workbuddy_discovery::start();
        return Ok(BridgeStartResult {
            status: "already-running".to_string(),
            message: "Bridge already running.".to_string(),
        });
    }

    local_bridge::start(learning_script.clone())?;
    let _ = codex_discovery::start(learning_script);
    let _ = workbuddy_discovery::start();

    Ok(BridgeStartResult {
        status: "started".to_string(),
        message: if connector.is_some() {
            "Native bridge started with bundled connector available.".to_string()
        } else {
            "Native bridge started. Connector was not found.".to_string()
        },
    })
}

#[tauri::command]
fn start_status_bridge(app: tauri::AppHandle) -> Result<BridgeStartResult, String> {
    start_status_bridge_inner(Some(&app))
}

#[cfg(target_os = "windows")]
fn run_windows_picker(script: &str) -> Result<Option<String>, String> {
    let mut command = std::process::Command::new("powershell.exe");
    command
        .args([
            "-NoProfile",
            "-STA",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let output = command
        .output()
        .map_err(|error| format!("Could not open file picker: {error}"))?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "File picker failed.".to_string()
        } else {
            detail
        });
    }

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok((!path.is_empty()).then_some(path))
}

#[cfg(target_os = "macos")]
fn run_macos_picker(script: &str) -> Result<Option<String>, String> {
    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|error| format!("Could not open file picker: {error}"))?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if detail.contains("-128") {
            return Ok(None);
        }
        return Err(if detail.is_empty() {
            "File picker failed.".to_string()
        } else {
            detail
        });
    }

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok((!path.is_empty()).then_some(path))
}

#[tauri::command]
fn pick_markdown_task_file() -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        return run_windows_picker(
            r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Choose Markdown task file'
$dialog.Filter = 'Markdown files (*.md)|*.md|All files (*.*)|*.*'
$dialog.CheckFileExists = $true
$dialog.Multiselect = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.FileName
}
"#,
        );
    }

    #[cfg(target_os = "macos")]
    {
        return run_macos_picker(
            r#"POSIX path of (choose file with prompt "Choose Markdown task file")"#,
        );
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err("File picker is not supported on this platform yet.".to_string())
    }
}

#[tauri::command]
fn pick_launcher_directory() -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        return run_windows_picker(
            r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose CLI launcher project folder'
$dialog.ShowNewFolderButton = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.SelectedPath
}
"#,
        );
    }

    #[cfg(target_os = "macos")]
    {
        return run_macos_picker(
            r#"POSIX path of (choose folder with prompt "Choose CLI launcher project folder")"#,
        );
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err("Directory picker is not supported on this platform yet.".to_string())
    }
}

#[cfg(target_os = "windows")]
fn powershell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(target_os = "macos")]
fn posix_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r#"'\''"#))
}

#[cfg(target_os = "macos")]
fn applescript_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn formatted_extra_args(args: Option<&str>) -> String {
    args.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!(" {value}"))
        .unwrap_or_default()
}

fn spawn_connected_runner_terminal(
    cwd: &std::path::Path,
    node_command: &std::path::Path,
    runner: &std::path::Path,
    agent: &str,
    runner_args: &[String],
    command: &std::path::Path,
    extra_args: &str,
    error_context: &str,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut wrapped_command = format!(
            "& {} {} --agent {}",
            powershell_single_quote(&node_command.to_string_lossy()),
            powershell_single_quote(&runner.to_string_lossy()),
            powershell_single_quote(agent),
        );
        for arg in runner_args {
            wrapped_command.push(' ');
            wrapped_command.push_str(&powershell_single_quote(arg));
        }
        wrapped_command.push_str(" -- ");
        wrapped_command.push_str(&powershell_single_quote(&command.to_string_lossy()));
        wrapped_command.push_str(extra_args);

        let start_script = format!(
            "Start-Process -FilePath 'powershell.exe' -WorkingDirectory {} -ArgumentList @('-NoExit','-NoProfile','-ExecutionPolicy','Bypass','-Command',{})",
            powershell_single_quote(&cwd.to_string_lossy()),
            powershell_single_quote(&wrapped_command),
        );

        let mut process = std::process::Command::new("powershell.exe");
        process
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &start_script,
            ])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());

        use std::os::windows::process::CommandExt;
        process.creation_flags(0x08000000);

        process
            .spawn()
            .map_err(|error| format!("Could not open {error_context}: {error}"))?;

        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let mut shell_command = format!(
            "cd {} && {} {} --agent {}",
            posix_single_quote(&cwd.to_string_lossy()),
            posix_single_quote(&node_command.to_string_lossy()),
            posix_single_quote(&runner.to_string_lossy()),
            posix_single_quote(agent),
        );
        for arg in runner_args {
            shell_command.push(' ');
            shell_command.push_str(&posix_single_quote(arg));
        }
        shell_command.push_str(" -- ");
        shell_command.push_str(&posix_single_quote(&command.to_string_lossy()));
        shell_command.push_str(extra_args);

        let do_script = format!("do script {}", applescript_string(&shell_command));
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg("tell application \"Terminal\"")
            .arg("-e")
            .arg("activate")
            .arg("-e")
            .arg(do_script)
            .arg("-e")
            .arg("end tell")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .output()
            .map_err(|error| format!("Could not open {error_context}: {error}"))?;

        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if detail.is_empty() {
                format!("Could not open {error_context}.")
            } else {
                detail
            });
        }

        return Ok(());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (
            cwd,
            node_command,
            runner,
            agent,
            runner_args,
            command,
            extra_args,
        );
        Err(format!(
            "Opening {error_context} is not supported on this platform yet."
        ))
    }
}

#[tauri::command]
fn start_agent_cli(
    app: tauri::AppHandle,
    request: AgentCliLaunchRequest,
) -> Result<AgentCliLaunchResult, String> {
    reject_synthetic_agent_access()?;
    let cwd = std::path::PathBuf::from(request.cwd.trim());
    if !cwd.is_dir() {
        return Err("Working directory does not exist.".to_string());
    }

    let (agent, command) = match request.agent.as_str() {
        "codex" => ("codex", "codex"),
        "claude-code" => ("claude-code", "claude"),
        "opencode" => ("opencode", "opencode"),
        _ => return Err("Unsupported agent.".to_string()),
    };

    let Some(agent_command) = resolve_command(command) else {
        return Err(format!(
            "{agent} CLI was not found on PATH. Install it first, then restart Aivatar."
        ));
    };
    let Some(node_command) = resolve_command("node") else {
        return Err(
            "Node.js was not found on PATH. Install Node.js first, then restart Aivatar."
                .to_string(),
        );
    };

    let _ = start_status_bridge_inner(Some(&app))?;

    let Some(scripts) = scripts_root(Some(&app)) else {
        return Err("Aivatar connected CLI runner was not found in the app resources.".to_string());
    };

    let runner = scripts.join("aivatar-connected-run.mjs");
    let extra_args = formatted_extra_args(request.args.as_deref());
    let mut runner_args = Vec::new();
    if request.allow_new_session.unwrap_or(false) && agent == "codex" {
        runner_args.extend([
            "--new-session".to_string(),
            "--expected-cwd".to_string(),
            cwd.to_string_lossy().to_string(),
            "--verify-desktop-listing".to_string(),
        ]);
    }

    spawn_connected_runner_terminal(
        &cwd,
        &node_command,
        &runner,
        agent,
        &runner_args,
        &agent_command,
        &extra_args,
        "agent terminal",
    )?;

    Ok(AgentCliLaunchResult {
        status: "started".to_string(),
        message: format!("Started {agent} in {}.", cwd.display()),
    })
}

fn safe_prompt_file_name(session_id: &str) -> String {
    let safe_id: String = session_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect();
    format!("{safe_id}.md")
}

#[tauri::command]
fn start_task_agent(
    app: tauri::AppHandle,
    request: TaskAgentLaunchRequest,
) -> Result<TaskAgentLaunchResult, String> {
    reject_synthetic_agent_access()?;
    let cwd = std::path::PathBuf::from(request.cwd.trim());
    if !cwd.is_dir() {
        return Err("Working directory does not exist.".to_string());
    }

    let task_path = std::path::PathBuf::from(request.task_path.trim());
    if task_path
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .map(|extension| !extension.eq_ignore_ascii_case("md"))
        .unwrap_or(true)
    {
        return Err("Task file must be a .md file.".to_string());
    }
    if !task_path.is_file() {
        return Err("Task file does not exist.".to_string());
    }

    let (agent, command) = match request.agent.as_str() {
        "codex" => ("codex", "codex"),
        "claude-code" => ("claude-code", "claude"),
        "opencode" => ("opencode", "opencode"),
        _ => return Err("Unsupported agent.".to_string()),
    };

    let Some(agent_command) = resolve_command(command) else {
        return Err(format!(
            "{agent} CLI was not found on PATH. Install it first, then restart Aivatar."
        ));
    };
    let Some(node_command) = resolve_command("node") else {
        return Err(
            "Node.js was not found on PATH. Install Node.js first, then restart Aivatar."
                .to_string(),
        );
    };

    let task_content = std::fs::read_to_string(&task_path)
        .map_err(|error| format!("Could not read task file: {error}"))?;
    let task_prompt_chars = task_content.chars().count();
    if task_prompt_chars > MAX_TASK_PROMPT_CHARS {
        return Err(format!(
            "Task prompt is too long for CLI launch ({task_prompt_chars} characters). Keep .md task prompts at or below {MAX_TASK_PROMPT_CHARS} characters."
        ));
    }

    let prompt_dir = std::env::temp_dir().join("aivatar-task-prompts");
    std::fs::create_dir_all(&prompt_dir)
        .map_err(|error| format!("Could not create task prompt directory: {error}"))?;
    let prompt_path = prompt_dir.join(safe_prompt_file_name(&request.session_id));
    std::fs::write(&prompt_path, task_content)
        .map_err(|error| format!("Could not create task prompt copy: {error}"))?;

    let _ = start_status_bridge_inner(Some(&app))?;

    let Some(scripts) = scripts_root(Some(&app)) else {
        return Err(
            "Aivatar connected task runner was not found in the app resources.".to_string(),
        );
    };

    let runner = scripts.join("aivatar-connected-run.mjs");
    let extra_args = formatted_extra_args(request.args.as_deref());
    let runner_args = vec![
        "--session".to_string(),
        request.session_id.clone(),
        "--prompt-file".to_string(),
        prompt_path.to_string_lossy().to_string(),
    ];

    spawn_connected_runner_terminal(
        &cwd,
        &node_command,
        &runner,
        agent,
        &runner_args,
        &agent_command,
        &extra_args,
        "task agent terminal",
    )?;

    Ok(TaskAgentLaunchResult {
        status: "started".to_string(),
        message: format!(
            "Started {agent} task {}.",
            task_path
                .file_name()
                .and_then(std::ffi::OsStr::to_str)
                .unwrap_or("task")
        ),
        session_id: request.session_id,
    })
}

#[tauri::command]
fn resize_main_window_for_side_panel(
    window: tauri::Window,
    width: f64,
    min_width: f64,
    height: f64,
) -> Result<(), String> {
    if desktop_mode::is_active(window.app_handle(), window.label()) {
        return Ok(());
    }
    desktop_mode::record_room_min_width(window.app_handle(), window.label(), min_width);
    let _ = window.set_maximizable(false);
    if window.is_maximized().unwrap_or(false) {
        window
            .unmaximize()
            .map_err(|error| format!("Could not restore window before resizing: {error}"))?;
    }
    let min_size = main_window_min_size(min_width);
    let size = main_window_size(width, height);

    window
        .set_min_size(Some(min_size))
        .map_err(|error| format!("Could not set window minimum size: {error}"))?;
    window
        .set_size(size)
        .map_err(|error| format!("Could not resize window: {error}"))?;

    Ok(())
}

#[tauri::command]
fn set_main_window_visibility_for_park_profile(
    app: tauri::AppHandle,
    caller: tauri::Window,
    visible: bool,
) -> Result<(), String> {
    let caller_label = caller.label().to_string();
    set_main_window_visibility_for_park_owner(&app, &caller_label, visible)
}

#[tauri::command]
async fn open_save_slot_window(
    app: tauri::AppHandle,
    request: SaveSlotWindowRequest,
) -> Result<SaveSlotWindowResult, String> {
    let _opening = WindowOpenGuard::acquire(&app)?;
    let slot_id = request.slot_id.trim();
    if slot_id.is_empty() {
        return Err("Save slot id is required.".to_string());
    }

    let label = save_slot_window_label(slot_id);
    if let Some(window) = app.get_webview_window(&label) {
        window
            .set_focus()
            .map_err(|error| format!("Could not focus save window: {error}"))?;
        return Ok(SaveSlotWindowResult { label });
    }

    let title = request
        .avatar_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(|name| format!("Aivatar - {name}"))
        .unwrap_or_else(|| "Aivatar".to_string());
    let url = format!("./?slotId={}", url_component(slot_id));
    let window = isolate_synthetic_window(tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App(std::path::PathBuf::from(url)),
    ))?
    .title(title)
    .inner_size(MAIN_WINDOW_DEFAULT_WIDTH, MAIN_WINDOW_DEFAULT_HEIGHT)
    .min_inner_size(MAIN_WINDOW_MIN_WIDTH, MAIN_WINDOW_MIN_HEIGHT)
    .resizable(false)
    .maximizable(false)
    .always_on_top(false)
    .decorations(true)
    .transparent(true)
    .accept_first_mouse(true)
    .focused(true)
    .additional_browser_args(WEBVIEW2_BROWSER_ARGS)
    .build()
    .map_err(|error| format!("Could not open save window: {error}"))?;

    attach_save_before_close_handler(window);

    Ok(SaveSlotWindowResult { label })
}

// Only the explicitly marked debug integration run appends this harness route.
// Ordinary development/release windows retain their existing URLs.
fn synthetic_view_url(url: String, view: &str) -> Result<String, String> {
    if synthetic_profile()?.is_some() {
        if let Some(phase) = synthetic_harness_phase()? {
            return Ok(format!("{url}&nativeStoreHarness=view&role={view}&phase={phase}"));
        }
    }
    Ok(url)
}

#[tauri::command]
async fn open_card_room_window(
    app: tauri::AppHandle,
    request: CardRoomWindowRequest,
) -> Result<CardRoomWindowResult, String> {
    let _opening = WindowOpenGuard::acquire(&app)?;
    let host_slot_id = request
        .host_slot_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("local-table");
    let label = card_room_window_label(host_slot_id);
    if let Some(window) = app.get_webview_window(&label) {
        window
            .set_focus()
            .map_err(|error| format!("Could not focus card room: {error}"))?;
        return Ok(CardRoomWindowResult { label });
    }

    let url = synthetic_view_url(format!(
        "./?view=card-room&hostSlotId={}",
        url_component(host_slot_id)
    ), "card-room")?;
    let window = isolate_synthetic_window(tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App(std::path::PathBuf::from(url)),
    ))?
    .title("Aivatar - Card Room")
    .inner_size(1180.0, 900.0)
    .min_inner_size(1180.0, 900.0)
    .resizable(false)
    .maximizable(false)
    .always_on_top(false)
    .decorations(true)
    .focused(true)
    .additional_browser_args(WEBVIEW2_BROWSER_ARGS)
    .build()
    .map_err(|error| format!("Could not open card room: {error}"))?;

    attach_save_before_close_handler(window);

    Ok(CardRoomWindowResult { label })
}

#[tauri::command]
async fn open_park_window(
    app: tauri::AppHandle,
    request: ParkWindowRequest,
) -> Result<ParkWindowResult, String> {
    let _opening = WindowOpenGuard::acquire(&app)?;
    let host_slot_id = request
        .host_slot_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("local-park");
    let label = park_window_label(host_slot_id);
    if let Some(window) = app.get_webview_window(&label) {
        window
            .set_focus()
            .map_err(|error| format!("Could not focus park: {error}"))?;
        return Ok(ParkWindowResult { label });
    }

    let url = synthetic_view_url(format!("./?view=park&hostSlotId={}", url_component(host_slot_id)), "park")?;
    let window = isolate_synthetic_window(tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App(std::path::PathBuf::from(url)),
    ))?
    .title("Aivatar - Hilltop Park")
    .inner_size(1180.0, 900.0)
    .min_inner_size(1180.0, 900.0)
    .resizable(false)
    .maximizable(false)
    .always_on_top(false)
    .decorations(true)
    .focused(false)
    .visible(false)
    .additional_browser_args(WEBVIEW2_BROWSER_ARGS)
    .build()
    .map_err(|error| format!("Could not open park: {error}"))?;
    attach_main_window_restore_handler(window.clone(), app.clone());
    attach_save_before_close_handler(window.clone());

    if let Err(error) = window.show().and_then(|_| window.set_focus()) {
        let _ = window.close();
        return Err(format!("Could not show park: {error}"));
    }

    Ok(ParkWindowResult { label })
}

#[tauri::command]
async fn open_park_developer_window(
    app: tauri::AppHandle,
    request: ParkWindowRequest,
) -> Result<ParkWindowResult, String> {
    let _opening = WindowOpenGuard::acquire(&app)?;
    let host_slot_id = request
        .host_slot_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("local-park");
    let label = park_developer_window_label(host_slot_id);
    if let Some(window) = app.get_webview_window(&label) {
        window
            .set_focus()
            .map_err(|error| format!("Could not focus park developer: {error}"))?;
        return Ok(ParkWindowResult { label });
    }

    let url = synthetic_view_url(format!(
        "./?view=park-developer&hostSlotId={}",
        url_component(host_slot_id)
    ), "park-developer")?;
    let window = isolate_synthetic_window(tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App(std::path::PathBuf::from(url)),
    ))?
    .title("Aivatar - Park Developer")
    .inner_size(1180.0, 900.0)
    .min_inner_size(960.0, 720.0)
    .resizable(true)
    .maximizable(true)
    .always_on_top(false)
    .decorations(true)
    .focused(true)
    .additional_browser_args(WEBVIEW2_BROWSER_ARGS)
    .build()
    .map_err(|error| format!("Could not open park developer: {error}"))?;

    attach_save_before_close_handler(window);

    Ok(ParkWindowResult { label })
}

#[tauri::command]
async fn open_park_animation_preview_window(
    app: tauri::AppHandle,
    request: ParkWindowRequest,
) -> Result<ParkWindowResult, String> {
    let _opening = WindowOpenGuard::acquire(&app)?;
    let host_slot_id = request
        .host_slot_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("local-park");
    let label = park_animation_preview_window_label(host_slot_id);
    if let Some(window) = app.get_webview_window(&label) {
        window
            .set_focus()
            .map_err(|error| format!("Could not focus park animation preview: {error}"))?;
        return Ok(ParkWindowResult { label });
    }

    let url = format!(
        "./?view=park-animation-preview&hostSlotId={}",
        url_component(host_slot_id)
    );
    let window = isolate_synthetic_window(tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App(std::path::PathBuf::from(url)),
    ))?
    .title("Aivatar - Character Animation Preview")
    .inner_size(760.0, 600.0)
    .min_inner_size(680.0, 520.0)
    .resizable(true)
    .maximizable(false)
    .always_on_top(false)
    .decorations(true)
    .focused(true)
    .additional_browser_args(WEBVIEW2_BROWSER_ARGS)
    .build()
    .map_err(|error| format!("Could not open park animation preview: {error}"))?;

    attach_store_window_lifecycle(&window);

    Ok(ParkWindowResult { label })
}

fn safe_social_room_memory_key(key: &str) -> String {
    let sanitized: String = key
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric()
                || character == '.'
                || character == '_'
                || character == '-'
            {
                character
            } else {
                '_'
            }
        })
        .take(180)
        .collect();

    if sanitized.trim_matches('_').is_empty() {
        "social-room-memory".to_string()
    } else {
        sanitized
    }
}

fn social_room_memory_path(
    app: &tauri::AppHandle,
    key: &str,
) -> Result<std::path::PathBuf, String> {
    let directory = app_owned_data_directory(app)?.join("social-room-memory");
    Ok(directory.join(format!("{}.json", safe_social_room_memory_key(key))))
}

#[tauri::command]
fn read_social_room_memory(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let path = social_room_memory_path(&app, &key)?;
    if !path.is_file() {
        return Ok(None);
    }
    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|error| format!("Could not read social room memory: {error}"))
}

#[tauri::command]
fn write_social_room_memory(
    app: tauri::AppHandle,
    key: String,
    payload: String,
) -> Result<(), String> {
    if payload.len() > 200_000 {
        return Err("Social room memory payload is too large.".to_string());
    }
    let _: serde_json::Value = serde_json::from_str(&payload)
        .map_err(|error| format!("Invalid social room memory JSON: {error}"))?;
    let path = social_room_memory_path(&app, &key)?;
    let Some(directory) = path.parent() else {
        return Err("Could not resolve social room memory directory.".to_string());
    };
    std::fs::create_dir_all(directory)
        .map_err(|error| format!("Could not create social room memory directory: {error}"))?;
    std::fs::write(&path, payload)
        .map_err(|error| format!("Could not write social room memory: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let synthetic = synthetic_profile().expect("invalid synthetic persistence profile");
    let mut context = tauri::generate_context!();
    if context.config().identifier.starts_with("com.aivatar.synthetic.") && synthetic.is_none() {
        panic!("a generated synthetic build requires its explicit profile marker");
    }
    if let Some(profile) = synthetic.as_ref() {
        assert_eq!(context.config().identifier, profile.identifier, "synthetic marker must match the generated build identifier");
        context.config_mut().identifier = profile.identifier.clone();
        for window in &mut context.config_mut().app.windows {
            window.data_store_identifier = Some(profile.data_store_identifier);
            window.data_directory = Some(profile.root.join("webview"));
            if let Some(phase) = synthetic_harness_phase().expect("invalid synthetic phase") {
                window.url = tauri::WebviewUrl::App(std::path::PathBuf::from(format!(
                    "./?nativeStoreHarness=main&phase={phase}"
                )));
            }
        }
        #[cfg(target_os = "windows")]
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", profile.root.join("webview"));
    }
    #[cfg(all(debug_assertions, target_os = "windows"))]
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
        let dev_profile = format!(
            "aivatar-webview2-dev-{:016x}",
            hash_value(env!("CARGO_MANIFEST_DIR")),
        );
        std::env::set_var(
            "WEBVIEW2_USER_DATA_FOLDER",
            std::env::temp_dir().join(dev_profile),
        );
    }

    let mut builder =
        tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            desktop_mode::restore_all_async(app, "second-launch");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    if synthetic.is_some() {
        builder = builder.plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("synthetic-persistence-isolation")
                .js_init_script_on_all_frames(SYNTHETIC_NETWORK_ISOLATION)
                .build(),
        );
    }
    let app = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(app_updater::AppUpdaterState::new(cfg!(debug_assertions) || synthetic.is_some()))
        .manage(desktop_mode::DesktopModeState::default())
        .manage(ParkProfileWindowState::default())
        .manage(CloseSaveState::default())
        .manage(SyntheticHarnessState::default())
        .invoke_handler(tauri::generate_handler![
            save_store_synthetic_control,
            save_store_bootstrap,
            save_store_migrate,
            save_store_read,
            save_store_commit,
            start_status_bridge,
            pick_markdown_task_file,
            pick_launcher_directory,
            start_agent_cli,
            start_task_agent,
            resize_main_window_for_side_panel,
            desktop_mode::enter_desktop_mode,
            desktop_mode::exit_desktop_mode,
            desktop_mode::update_desktop_hit_regions,
            set_main_window_visibility_for_park_profile,
            confirm_close_after_save,
            app_updater::app_update_status,
            app_updater::app_update_check,
            app_updater::app_update_download,
            app_updater::app_update_install,
            app_updater::app_update_confirm_save,
            open_save_slot_window,
            open_card_room_window,
            open_park_window,
            open_park_developer_window,
            open_park_animation_preview_window,
            get_agent_integrations,
            enable_agent_integration,
            read_social_room_memory,
            write_social_room_memory
        ])
        .setup(|app| {
            let directory =
                app_owned_data_directory(app.handle()).map_err(std::io::Error::other)?;
            // Debug/dev WebViews use a separate legacy origin. Never let a dev
            // launch activate an empty release store in the shared app-data root.
            let development = cfg!(debug_assertions) && synthetic_profile()?.is_none();
            app.manage(Arc::new(save_store::SaveStore::new(
                directory.join(save_store::storage_directory_name(development)),
            )));
            if let Some(window) = app.get_webview_window("main") {
                normalize_main_window_size(&window);
                attach_save_before_close_handler(window);
            }
            let app_handle = app.handle().clone();
            let _ = start_status_bridge_inner(Some(&app_handle));
            Ok(())
        })
        .build(context)
        .expect("error while building Aivatar");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if matches!(&event, tauri::RunEvent::Reopen { .. }) {
            desktop_mode::restore_all_async(app_handle, "dock-reopen");
        }
        if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
            // This restart follows an already completed all-window save barrier.
            if app_updater::installed_exit(app_handle) {
                return;
            }
            let windows = app_handle.webview_windows();
            let close_state = app_handle.state::<CloseSaveState>();
            let mut close_windows = match close_state.windows.lock() {
                Ok(windows) => windows,
                Err(_) => return,
            };

            if close_windows.updating {
                api.prevent_exit();
                return;
            }

            if close_windows.replaying_exit {
                close_windows.replaying_exit = false;
                return;
            }

            if windows.is_empty() {
                if let Some(requested_code) = close_windows.pending_exit_code.take() {
                    close_windows.replaying_exit = true;
                    drop(close_windows);
                    api.prevent_exit();
                    app_handle.exit(requested_code.unwrap_or(0));
                }
                return;
            }

            // App-level quit requests can bypass WindowEvent::CloseRequested. Convert them
            // into ordinary window closes so every persistent window completes its save ACK.
            if close_windows.pending_exit_code.is_none() {
                close_windows.pending_exit_code = Some(code);
            }
            drop(close_windows);
            api.prevent_exit();
            for window in windows.into_values() {
                let _ = window.close();
            }
        }
    });
}
