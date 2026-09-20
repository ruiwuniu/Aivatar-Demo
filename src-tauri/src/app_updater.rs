//! One updater owner per process. Renderers never choose an update URL, key,
//! package, or install path, and installation is gated by every save owner.
use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const UPDATE_ENDPOINT: &str =
    "https://github.com/ruiwuniu/Aivatar-Demo/releases/latest/download/latest.json";
const MAX_MANIFEST_BYTES: usize = 256 * 1024;
// Current Windows installers are about 313 MB; leave upgrade headroom while
// bounding unauthenticated network data before signature verification.
const MAX_PACKAGE_BYTES: usize = 512 * 1024 * 1024;
const SAVE_TIMEOUT: Duration = Duration::from_secs(20);
const STATE_EVENT: &str = "aivatar://updater-state";
const SAVE_EVENT: &str = "aivatar://save-before-update";
const CANCEL_SAVE_EVENT: &str = "aivatar://update-save-cancelled";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshot {
    revision: u64,
    phase: &'static str,
    current_version: String,
    version: Option<String>,
    notes: Option<String>,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    error: Option<String>,
    checked_at: Option<u64>,
}

struct UpdaterInner {
    snapshot: UpdateSnapshot,
    automatic_checked: bool,
    candidate: Option<Update>,
    verified_bytes: Option<Arc<Vec<u8>>>,
    next_request: u64,
    barrier: Option<SaveBarrier>,
    installed_exit: bool,
}

pub struct AppUpdaterState {
    inner: Mutex<UpdaterInner>,
    save_changed: Condvar,
}

impl AppUpdaterState {
    pub fn new(disabled: bool) -> Self {
        Self {
            inner: Mutex::new(UpdaterInner {
                snapshot: UpdateSnapshot {
                    revision: 0,
                    phase: if disabled { "disabled" } else { "idle" },
                    current_version: env!("CARGO_PKG_VERSION").into(),
                    version: None,
                    notes: None,
                    downloaded_bytes: 0,
                    total_bytes: None,
                    error: None,
                    checked_at: None,
                },
                automatic_checked: false,
                candidate: None,
                verified_bytes: None,
                next_request: 0,
                barrier: None,
                installed_exit: false,
            }),
            save_changed: Condvar::new(),
        }
    }
}

#[derive(Debug)]
struct SaveBarrier {
    request_id: u64,
    pending: HashMap<String, bool>,
    failure: Option<String>,
}

impl SaveBarrier {
    fn new(request_id: u64, labels: impl IntoIterator<Item = String>) -> Self {
        Self {
            request_id,
            pending: labels.into_iter().map(|label| (label, false)).collect(),
            failure: None,
        }
    }

    fn acknowledge(&mut self, label: &str, request_id: u64, ok: bool) -> Result<(), String> {
        if request_id != self.request_id {
            return Err("This update save request has expired.".into());
        }
        let saved = self
            .pending
            .get_mut(label)
            .ok_or("This window is not an update save participant.")?;
        if !ok {
            self.failure =
                Some("An open window could not save. The update was not installed.".into());
        } else {
            *saved = true;
        }
        Ok(())
    }

    fn complete(&self) -> bool {
        self.failure.is_none()
            && !self.pending.is_empty()
            && self.pending.values().all(|saved| *saved)
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveRequest {
    request_id: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSaveStatus {
    request_id: u64,
    active: bool,
    phase: &'static str,
}

fn save_request_status(inner: &UpdaterInner, label: &str, request_id: u64) -> UpdateSaveStatus {
    let active = inner.barrier.as_ref().is_some_and(|barrier| {
        barrier.request_id == request_id && barrier.pending.contains_key(label)
    }) && matches!(inner.snapshot.phase, "saving" | "installing");
    UpdateSaveStatus {
        request_id,
        active,
        phase: if active {
            inner.snapshot.phase
        } else {
            "inactive"
        },
    }
}

#[tauri::command]
pub fn app_update_save_status(
    window: tauri::WebviewWindow,
    request_id: u64,
) -> Result<UpdateSaveStatus, String> {
    let state = window.state::<AppUpdaterState>();
    let inner = state.inner.lock().map_err(|_| lock_error())?;
    Ok(save_request_status(&inner, window.label(), request_id))
}

fn lock_error() -> String {
    "The updater is temporarily unavailable.".into()
}

fn bounded_text(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

fn publish(app: &tauri::AppHandle, inner: &mut UpdaterInner) -> UpdateSnapshot {
    inner.snapshot.revision = inner.snapshot.revision.saturating_add(1);
    let snapshot = inner.snapshot.clone();
    let _ = app.emit(STATE_EVENT, &snapshot);
    snapshot
}

fn allowed_caller(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" || window.label().starts_with("save-slot-") {
        Ok(())
    } else {
        Err("Open a room's Settings to manage Aivatar updates.".into())
    }
}

fn busy(phase: &str) -> bool {
    matches!(phase, "checking" | "downloading" | "saving" | "installing")
}

fn trusted_download_url(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url
            .path()
            .starts_with("/ruiwuniu/Aivatar-Demo/releases/download/")
}

#[tauri::command]
pub fn app_update_status(window: tauri::WebviewWindow) -> Result<UpdateSnapshot, String> {
    allowed_caller(&window)?;
    let state = window.state::<AppUpdaterState>();
    let inner = state.inner.lock().map_err(|_| lock_error())?;
    Ok(inner.snapshot.clone())
}

#[tauri::command]
pub async fn app_update_check(
    window: tauri::WebviewWindow,
    automatic: Option<bool>,
) -> Result<UpdateSnapshot, String> {
    allowed_caller(&window)?;
    let app = window.app_handle().clone();
    let state = app.state::<AppUpdaterState>();
    {
        let mut inner = state.inner.lock().map_err(|_| lock_error())?;
        if inner.snapshot.phase == "disabled"
            || busy(inner.snapshot.phase)
            || inner.snapshot.phase == "downloaded"
            || (automatic == Some(true) && inner.automatic_checked)
        {
            return Ok(inner.snapshot.clone());
        }
        if automatic == Some(true) {
            inner.automatic_checked = true;
        }
        inner.snapshot.phase = "checking";
        inner.snapshot.error = None;
        inner.snapshot.version = None;
        inner.snapshot.notes = None;
        inner.snapshot.downloaded_bytes = 0;
        inner.snapshot.total_bytes = None;
        inner.candidate = None;
        inner.verified_bytes = None;
        publish(&app, &mut inner);
    }
    let checked = async {
        // Keep the endpoint native and fixed even if a renderer is compromised.
        let updater = app
            .updater_builder()
            // UpdaterExt normally cleans up WebViews before attempting to
            // launch the Windows installer. Keep them alive if launch fails;
            // our save barrier already handles durable state before install.
            .on_before_exit(|| {})
            .network_limits(tauri_plugin_updater::NetworkLimits {
                max_manifest_bytes: MAX_MANIFEST_BYTES,
                max_download_bytes: MAX_PACKAGE_BYTES,
                allowed_hosts: vec![
                    "github.com".into(),
                    "release-assets.githubusercontent.com".into(),
                ],
                max_redirects: 5,
            })
            .endpoints(vec![UPDATE_ENDPOINT
                .parse()
                .map_err(|_| "Invalid built-in update endpoint.".to_string())?])
            .map_err(|error| error.to_string())?
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|error| error.to_string())?;
        updater.check().await.map_err(|error| error.to_string())
    }
    .await;
    let mut inner = state.inner.lock().map_err(|_| lock_error())?;
    if checked.is_ok() {
        inner.snapshot.checked_at = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        );
    }
    match checked {
        Ok(Some(mut update)) if trusted_download_url(&update.download_url) => {
            update.timeout = Some(Duration::from_secs(600));
            inner.snapshot.phase = "available";
            inner.snapshot.version = Some(update.version.clone());
            inner.snapshot.notes = update
                .body
                .as_deref()
                .map(|notes| bounded_text(notes, 20_000));
            inner.candidate = Some(update);
        }
        Ok(Some(_)) => {
            inner.snapshot.phase = "error";
            inner.snapshot.error =
                Some("The update does not point to an official Aivatar release.".into());
        }
        Ok(None) => inner.snapshot.phase = "idle",
        Err(error) => {
            inner.snapshot.phase = "error";
            inner.snapshot.error = Some(format!(
                "Could not check for updates: {}",
                bounded_text(&error, 1_000)
            ));
        }
    }
    Ok(publish(&app, &mut inner))
}

#[tauri::command]
pub async fn app_update_download(window: tauri::WebviewWindow) -> Result<UpdateSnapshot, String> {
    allowed_caller(&window)?;
    let app = window.app_handle().clone();
    let state = app.state::<AppUpdaterState>();
    let update = {
        let mut inner = state.inner.lock().map_err(|_| lock_error())?;
        if inner.snapshot.phase != "available" {
            return Ok(inner.snapshot.clone());
        }
        let update = inner
            .candidate
            .clone()
            .ok_or("Check for an update first.")?;
        inner.snapshot.phase = "downloading";
        inner.snapshot.error = None;
        inner.snapshot.downloaded_bytes = 0;
        inner.snapshot.total_bytes = None;
        publish(&app, &mut inner);
        update
    };
    let mut downloaded = 0_u64;
    let mut last_event = Instant::now() - Duration::from_secs(1);
    let result = update
        .download(
            |chunk, total| {
                downloaded = downloaded.saturating_add(chunk as u64);
                if let Ok(mut inner) = state.inner.lock() {
                    inner.snapshot.downloaded_bytes = downloaded;
                    inner.snapshot.total_bytes = total;
                    if last_event.elapsed() >= Duration::from_millis(100) {
                        publish(&app, &mut inner);
                        last_event = Instant::now();
                    }
                }
            },
            || {},
        )
        .await;
    let mut inner = state.inner.lock().map_err(|_| lock_error())?;
    match result {
        Ok(bytes) => {
            // download() returns only after Tauri's mandatory signature check.
            inner.snapshot.downloaded_bytes = bytes.len() as u64;
            inner.verified_bytes = Some(Arc::new(bytes));
            inner.snapshot.phase = "downloaded";
        }
        Err(error) => {
            inner.snapshot.phase = "available";
            inner.snapshot.error = Some(format!(
                "The download or signature check failed: {}",
                bounded_text(&error.to_string(), 1_000)
            ));
        }
    }
    Ok(publish(&app, &mut inner))
}

#[tauri::command]
pub fn app_update_confirm_save(
    window: tauri::WebviewWindow,
    request_id: u64,
    ok: bool,
) -> Result<(), String> {
    let state = window.state::<AppUpdaterState>();
    let mut inner = state.inner.lock().map_err(|_| lock_error())?;
    inner
        .barrier
        .as_mut()
        .ok_or("This update save request has expired.")?
        .acknowledge(window.label(), request_id, ok)?;
    state.save_changed.notify_all();
    Ok(())
}

pub fn window_destroyed(app: &tauri::AppHandle, label: &str) {
    if let Ok(mut inner) = app.state::<AppUpdaterState>().inner.lock() {
        if let Some(barrier) = inner.barrier.as_mut() {
            if barrier.pending.contains_key(label) {
                barrier.failure =
                    Some("A save window closed during update preparation. Please retry.".into());
                app.state::<AppUpdaterState>().save_changed.notify_all();
            }
        }
    }
}

pub fn installed_exit(app: &tauri::AppHandle) -> bool {
    app.state::<AppUpdaterState>()
        .inner
        .lock()
        .map(|inner| inner.installed_exit)
        .unwrap_or(false)
}

fn install_saved_update(app: tauri::AppHandle) -> Result<UpdateSnapshot, String> {
    let state = app.state::<AppUpdaterState>();
    // The close coordinator is also the window-creation gate. A pending normal
    // close/open and an update install can never own the same save producers.
    let (request_id, labels, update, bytes) = {
        let close = app.state::<crate::CloseSaveState>();
        let mut windows = close.windows.lock().map_err(|_| lock_error())?;
        let mut inner = state.inner.lock().map_err(|_| lock_error())?;
        if inner.snapshot.phase != "downloaded" {
            return Ok(inner.snapshot.clone());
        }
        if !windows.can_start_update() {
            return Err(
                "A window is opening or saving. Please retry the update in a moment.".into(),
            );
        }
        let labels: Vec<String> = windows.persistent.iter().cloned().collect();
        if labels.is_empty() {
            return Err("No save window is ready for the update.".into());
        }
        let update = inner
            .candidate
            .clone()
            .ok_or("The downloaded update is unavailable.")?;
        let bytes = inner
            .verified_bytes
            .clone()
            .ok_or("Download and verify the update first.")?;
        windows.updating = true;
        inner.next_request = inner.next_request.saturating_add(1);
        let request_id = inner.next_request;
        inner.barrier = Some(SaveBarrier::new(request_id, labels.clone()));
        inner.snapshot.phase = "saving";
        inner.snapshot.error = None;
        publish(&app, &mut inner);
        (request_id, labels, update, bytes)
    };
    let outcome = (|| {
        for label in &labels {
            let window = app
                .get_webview_window(label)
                .ok_or("A save window is no longer available.")?;
            window
                .emit_to(label.as_str(), SAVE_EVENT, SaveRequest { request_id })
                .map_err(|_| "Could not ask every open window to save.".to_string())?;
        }
        let deadline = Instant::now() + SAVE_TIMEOUT;
        let mut inner = state.inner.lock().map_err(|_| lock_error())?;
        loop {
            let barrier = inner
                .barrier
                .as_ref()
                .ok_or("The update save request expired.")?;
            if let Some(error) = &barrier.failure {
                return Err(error.clone());
            }
            if barrier.complete() {
                break;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(
                    "Saving all open windows timed out. The update was not installed.".into(),
                );
            }
            (inner, _) = state
                .save_changed
                .wait_timeout(inner, remaining)
                .map_err(|_| lock_error())?;
        }
        inner.snapshot.phase = "installing";
        publish(&app, &mut inner);
        drop(inner);
        // Windows starts its installer and exits here, so every renderer must
        // already be frozen and every durable write acknowledged before this.
        update.install(bytes.as_slice()).map_err(|error| {
            format!(
                "The update could not be installed: {}",
                bounded_text(&error.to_string(), 1_000)
            )
        })?;
        Ok::<(), String>(())
    })();

    if let Err(error) = outcome {
        // Leave all windows and the verified package available for a retry.
        // Clear the native barrier before notifying renderers: they authenticate
        // cancellation by querying this state. Keep the lifecycle gate held
        // until notifications have been sent, excluding a newer install.
        let close = app.state::<crate::CloseSaveState>();
        let mut windows = close.windows.lock().map_err(|_| lock_error())?;
        let snapshot = {
            let mut inner = state.inner.lock().map_err(|_| lock_error())?;
            inner.barrier = None;
            inner.snapshot.phase = "downloaded";
            inner.snapshot.error = Some(error);
            publish(&app, &mut inner)
        };
        for label in &labels {
            let _ = app.emit_to(
                label.as_str(),
                CANCEL_SAVE_EVENT,
                SaveRequest { request_id },
            );
        }
        windows.updating = false;
        return Ok(snapshot);
    }
    let snapshot = {
        let mut inner = state.inner.lock().map_err(|_| lock_error())?;
        inner.installed_exit = true;
        inner.snapshot.clone()
    };
    app.request_restart();
    Ok(snapshot)
}

#[tauri::command]
pub async fn app_update_install(window: tauri::WebviewWindow) -> Result<UpdateSnapshot, String> {
    allowed_caller(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || install_saved_update(app))
        .await
        .map_err(|_| {
            "The updater could not finish. Please restart Aivatar and retry.".to_string()
        })?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_window_must_acknowledge_the_same_request() {
        let mut barrier = SaveBarrier::new(
            7,
            ["main".into(), "park-one".into(), "card-room-one".into()],
        );
        assert!(!barrier.complete());
        assert!(barrier.acknowledge("main", 6, true).is_err());
        assert!(barrier.acknowledge("not-a-participant", 7, true).is_err());
        barrier.acknowledge("main", 7, true).unwrap();
        barrier.acknowledge("park-one", 7, true).unwrap();
        assert!(!barrier.complete());
        barrier.acknowledge("card-room-one", 7, true).unwrap();
        assert!(barrier.complete());
    }

    #[test]
    fn failed_save_cannot_be_repaired_by_a_late_success_ack() {
        let mut barrier = SaveBarrier::new(1, ["main".into()]);
        barrier.acknowledge("main", 1, false).unwrap();
        barrier.acknowledge("main", 1, true).unwrap();
        assert!(!barrier.complete());
        assert!(barrier.failure.is_some());
        assert!(!SaveBarrier::new(2, []).complete());
    }

    #[test]
    fn only_official_https_release_artifacts_are_accepted() {
        for url in [
            "https://github.com/ruiwuniu/Aivatar-Demo/releases/download/v0.5.1/Aivatar.app.tar.gz",
            "https://github.com/ruiwuniu/Aivatar-Demo/releases/download/v0.5.1/Aivatar.exe",
        ] {
            assert!(trusted_download_url(&url.parse().unwrap()));
        }
        for url in [
            "http://github.com/ruiwuniu/Aivatar-Demo/releases/download/v0.5.1/app.exe",
            "https://github.com/other/repo/releases/download/v1/app.exe",
            "https://github.com.evil.invalid/ruiwuniu/Aivatar-Demo/releases/download/v1/app.exe",
            "https://github.com:8443/ruiwuniu/Aivatar-Demo/releases/download/v1/app.exe",
            "https://user@github.com/ruiwuniu/Aivatar-Demo/releases/download/v1/app.exe",
        ] {
            assert!(!trusted_download_url(&url.parse().unwrap()));
        }
    }

    #[test]
    fn synthetic_and_development_state_cannot_start_an_update() {
        let state = AppUpdaterState::new(true);
        let inner = state.inner.lock().unwrap();
        assert_eq!(inner.snapshot.phase, "disabled");
        assert!(inner.candidate.is_none());
        assert!(inner.verified_bytes.is_none());
    }

    #[test]
    fn normal_window_lifecycle_and_update_install_are_exclusive() {
        let mut windows = crate::CloseSaveWindows::default();
        assert!(windows.can_start_update());
        windows.opening_windows = 1;
        assert!(!windows.can_start_update());
        windows.opening_windows = 0;
        windows.pending.insert("main".into(), 1);
        assert!(!windows.can_start_update());
        windows.pending.clear();
        windows.approved.insert("main".into());
        assert!(!windows.can_start_update());
        windows.approved.clear();
        windows.pending_exit_code = Some(None);
        assert!(!windows.can_start_update());
        windows.pending_exit_code = None;
        windows.replaying_exit = true;
        assert!(!windows.can_start_update());
        windows.replaying_exit = false;
        windows.updating = true;
        assert!(!windows.can_start_update());
    }

    #[test]
    fn save_status_authenticates_request_window_and_native_phase() {
        let state = AppUpdaterState::new(false);
        let mut inner = state.inner.lock().unwrap();
        inner.barrier = Some(SaveBarrier::new(17, ["main".into(), "park-one".into()]));
        for phase in ["saving", "installing"] {
            inner.snapshot.phase = phase;
            let status = save_request_status(&inner, "main", 17);
            assert!(status.active);
            assert_eq!(status.phase, phase);
            assert!(save_request_status(&inner, "park-one", 17).active);
            assert!(!save_request_status(&inner, "unrelated-window", 17).active);
            assert!(!save_request_status(&inner, "main", 16).active);
        }
        inner.snapshot.phase = "downloaded";
        assert!(!save_request_status(&inner, "main", 17).active);
        inner.snapshot.phase = "saving";
        inner.barrier = None;
        assert!(!save_request_status(&inner, "main", 17).active);
    }
}
