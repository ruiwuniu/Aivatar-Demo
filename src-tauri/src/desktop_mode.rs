//! A room keeps its WebView and save owner while its native window becomes the desktop canvas.
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopViewport {
    width: f64,
    height: f64,
    scale_factor: f64,
    monitor_id: String,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HitRegion {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl HitRegion {
    fn valid(&self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| v.is_finite())
            && self.width > 0.0
            && self.height > 0.0
            && self.width <= 32_768.0
            && self.height <= 32_768.0
            && self.x.abs() <= 32_768.0
            && self.y.abs() <= 32_768.0
    }

    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.width && y < self.y + self.height
    }
}

#[derive(Clone)]
struct RoomWindow {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    min_width: f64,
    decorated: bool,
    resizable: bool,
    maximizable: bool,
    always_on_top: bool,
}

#[derive(Clone)]
struct Session {
    room: RoomWindow,
    viewport: DesktopViewport,
    origin: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    regions: Vec<HitRegion>,
    dragging: bool,
    ignoring: bool,
    heartbeat: Instant,
    restoring: bool,
    transitioning: bool,
}

#[derive(Default)]
struct Inner {
    sessions: HashMap<String, Session>,
    room_min_widths: HashMap<String, f64>,
}

#[derive(Default)]
pub struct DesktopModeState {
    // Serializes native operations without holding Inner across window events.
    operation: Mutex<()>,
    inner: Mutex<Inner>,
    worker_started: AtomicBool,
}

fn allowed(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" || window.label().starts_with("save-slot-") {
        Ok(())
    } else {
        Err("Desktop mode is only available in an avatar's room window.".into())
    }
}

pub fn is_active(app: &tauri::AppHandle, label: &str) -> bool {
    app.try_state::<DesktopModeState>()
        .and_then(|state| {
            state
                .inner
                .lock()
                .ok()
                .map(|inner| inner.sessions.contains_key(label))
        })
        .unwrap_or(false)
}

pub fn record_room_min_width(app: &tauri::AppHandle, label: &str, width: f64) {
    if let Some(state) = app.try_state::<DesktopModeState>() {
        if let Ok(mut inner) = state.inner.lock() {
            if !inner.sessions.contains_key(label) {
                inner.room_min_widths.insert(label.into(), width);
            }
        }
    }
}

fn monitor_id(monitor: &tauri::Monitor) -> String {
    monitor
        .name()
        .cloned()
        .unwrap_or_else(|| format!("display@{},{}", monitor.position().x, monitor.position().y))
}

fn choose_monitor(
    window: &WebviewWindow,
    preferred: Option<&str>,
) -> Result<tauri::Monitor, String> {
    if let Some(preferred) = preferred {
        if let Some(monitor) = window
            .available_monitors()
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|monitor| monitor_id(monitor) == preferred)
        {
            return Ok(monitor);
        }
    }
    window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or(window.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or_else(|| "No available display was found.".into())
}

fn viewport(monitor: &tauri::Monitor) -> DesktopViewport {
    let scale_factor = monitor.scale_factor();
    DesktopViewport {
        width: f64::from(monitor.work_area().size.width) / scale_factor,
        height: f64::from(monitor.work_area().size.height) / scale_factor,
        scale_factor,
        monitor_id: monitor_id(monitor),
    }
}

fn should_ignore(session: &Session, cursor: PhysicalPosition<f64>) -> bool {
    if session.dragging {
        return false;
    }
    let x = (cursor.x - f64::from(session.origin.x)) / session.viewport.scale_factor;
    let y = (cursor.y - f64::from(session.origin.y)) / session.viewport.scale_factor;
    !session.regions.iter().any(|region| region.contains(x, y))
}

fn fit_room_position(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    origin: PhysicalPosition<i32>,
    work_size: PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    let max_x = i64::from(origin.x) + i64::from(work_size.width.saturating_sub(size.width));
    let max_y = i64::from(origin.y) + i64::from(work_size.height.saturating_sub(size.height));
    PhysicalPosition::new(
        i64::from(position.x).clamp(i64::from(origin.x), max_x) as i32,
        i64::from(position.y).clamp(i64::from(origin.y), max_y) as i32,
    )
}

fn recover_room_position(window: &WebviewWindow, room: &RoomWindow) -> PhysicalPosition<i32> {
    let monitors = window.available_monitors().unwrap_or_default();
    let monitor = monitors
        .into_iter()
        .find(|monitor| {
            let area = monitor.work_area();
            let x = i64::from(room.position.x);
            let y = i64::from(room.position.y);
            x >= i64::from(area.position.x)
                && x < i64::from(area.position.x) + i64::from(area.size.width)
                && y >= i64::from(area.position.y)
                && y < i64::from(area.position.y) + i64::from(area.size.height)
        })
        .or_else(|| window.primary_monitor().ok().flatten());
    monitor
        .map(|monitor| {
            fit_room_position(
                room.position,
                room.size,
                monitor.work_area().position,
                monitor.work_area().size,
            )
        })
        .unwrap_or(room.position)
}

fn restore_window(window: &WebviewWindow, room: &RoomWindow) -> Result<(), String> {
    // Try every recovery step even when an earlier call fails, especially cursor recovery.
    let room_position = recover_room_position(window, room);
    let operations = [
        window.set_ignore_cursor_events(false),
        window.set_focusable(true),
        window.set_always_on_top(room.always_on_top),
        window.set_decorations(room.decorated),
        window.set_shadow(true),
        window.set_resizable(room.resizable),
        window.set_maximizable(room.maximizable),
        window.set_min_size(Some(crate::main_window_min_size(room.min_width))),
        window.set_size(room.size),
        window.set_position(room_position),
        window.unminimize(),
        window.show(),
    ];
    let errors: Vec<String> = operations
        .into_iter()
        .filter_map(Result::err)
        .map(|e| e.to_string())
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn exit_inner(window: &WebviewWindow, reason: &str) -> Result<(), String> {
    let state = window.state::<DesktopModeState>();
    let _operation = state
        .operation
        .lock()
        .map_err(|_| "Desktop window operation is unavailable.")?;
    let session = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "Desktop state is unavailable.")?;
        let Some(session) = inner.sessions.get_mut(window.label()) else {
            return window
                .set_ignore_cursor_events(false)
                .map_err(|e| e.to_string());
        };
        session.restoring = true;
        session.clone()
    };
    restore_window(window, &session.room)?;
    if matches!(reason, "return-to-room" | "second-launch" | "dock-reopen") {
        let _ = window.set_focus();
    }
    state
        .inner
        .lock()
        .map_err(|_| "Desktop state is unavailable.")?
        .sessions
        .remove(window.label());
    let _ = window.emit_to(
        window.label(),
        "aivatar://desktop-mode-ended",
        serde_json::json!({ "reason": reason }),
    );
    Ok(())
}

pub fn restore_async(window: WebviewWindow, reason: &'static str) {
    tauri::async_runtime::spawn_blocking(move || {
        let _ = exit_inner(&window, reason);
    });
}

pub fn restore_all_async(app: &tauri::AppHandle, reason: &'static str) {
    let labels = app
        .try_state::<DesktopModeState>()
        .and_then(|state| {
            state
                .inner
                .lock()
                .ok()
                .map(|inner| inner.sessions.keys().cloned().collect::<Vec<_>>())
        })
        .unwrap_or_default();
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            restore_async(window, reason);
        }
    }
}

pub fn forget_window(app: &tauri::AppHandle, label: &str) {
    if let Some(state) = app.try_state::<DesktopModeState>() {
        if let Ok(mut inner) = state.inner.lock() {
            inner.sessions.remove(label);
            inner.room_min_widths.remove(label);
        }
    }
}

fn start_worker(app: tauri::AppHandle) {
    if app
        .state::<DesktopModeState>()
        .worker_started
        .swap(true, Ordering::SeqCst)
    {
        return;
    }
    std::thread::spawn(move || {
        let mut display_check = Instant::now();
        loop {
            std::thread::sleep(Duration::from_millis(25));
            let state = app.state::<DesktopModeState>();
            let sessions = match state.inner.lock() {
                Ok(inner) => inner.sessions.clone(),
                Err(_) => continue,
            };
            if sessions.is_empty() {
                // End the worker when there are no desktop windows; synchronize with entry.
                if let Ok(_operation) = state.operation.lock() {
                    if state
                        .inner
                        .lock()
                        .map(|inner| inner.sessions.is_empty())
                        .unwrap_or(true)
                    {
                        state.worker_started.store(false, Ordering::SeqCst);
                        break;
                    }
                }
                continue;
            }
            let check_display = display_check.elapsed() >= Duration::from_secs(1);
            if check_display {
                display_check = Instant::now();
            }
            for (label, snapshot) in sessions {
                if snapshot.transitioning {
                    continue;
                }
                let Some(window) = app.get_webview_window(&label) else {
                    forget_window(&app, &label);
                    continue;
                };
                if snapshot.restoring && !check_display {
                    continue;
                }
                if snapshot.restoring || snapshot.heartbeat.elapsed() > HEARTBEAT_TIMEOUT {
                    let _ = exit_inner(&window, "watchdog");
                    continue;
                }
                let Ok(_operation) = state.operation.lock() else {
                    continue;
                };
                let current = state
                    .inner
                    .lock()
                    .ok()
                    .and_then(|inner| inner.sessions.get(&label).cloned());
                let Some(mut current) = current else {
                    continue;
                };
                if current.restoring {
                    continue;
                }
                if check_display {
                    if let Ok(monitor) = choose_monitor(&window, Some(&current.viewport.monitor_id))
                    {
                        let next = viewport(&monitor);
                        let area = monitor.work_area();
                        if area.position != current.origin
                            || area.size != current.size
                            || next.scale_factor != current.viewport.scale_factor
                            || next.monitor_id != current.viewport.monitor_id
                        {
                            if window
                                .set_position(area.position)
                                .and_then(|_| window.set_size(area.size))
                                .is_ok()
                            {
                                current.origin = area.position;
                                current.size = area.size;
                                current.viewport = next.clone();
                                // The old hit boxes are no longer authoritative after layout changes.
                                current.regions.clear();
                                current.dragging = false;
                                if let Ok(mut inner) = state.inner.lock() {
                                    if let Some(session) = inner.sessions.get_mut(&label) {
                                        session.origin = current.origin;
                                        session.size = current.size;
                                        session.viewport = next.clone();
                                        session.regions.clear();
                                        session.dragging = false;
                                    }
                                }
                                let _ = window.emit_to(&label, "aivatar://desktop-viewport", next);
                            }
                        }
                    }
                }
                if let Ok(cursor) = app.cursor_position() {
                    let ignore = should_ignore(&current, cursor);
                    if ignore != current.ignoring && window.set_ignore_cursor_events(ignore).is_ok()
                    {
                        current.ignoring = ignore;
                    }
                }
                if let Ok(mut inner) = state.inner.lock() {
                    if let Some(session) = inner.sessions.get_mut(&label) {
                        // A renderer heartbeat can update hit boxes concurrently with this poll.
                        session.origin = current.origin;
                        session.size = current.size;
                        session.viewport = current.viewport;
                        session.ignoring = current.ignoring;
                    }
                }
            }
        }
    });
}

#[tauri::command(rename_all = "camelCase")]
pub async fn enter_desktop_mode(
    window: WebviewWindow,
    preferred_monitor: Option<String>,
) -> Result<DesktopViewport, String> {
    allowed(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let app = window.app_handle();
        let state = window.state::<DesktopModeState>();
        let _operation = state
            .operation
            .lock()
            .map_err(|_| "Desktop window operation is unavailable.")?;
        if app
            .state::<crate::ParkProfileWindowState>()
            .hidden_by
            .lock()
            .map_err(|_| "Park window state is unavailable.")?
            .is_some()
        {
            return Err("Return from the park before entering desktop mode.".into());
        }
        let min_width = {
            let inner = state
                .inner
                .lock()
                .map_err(|_| "Desktop state is unavailable.")?;
            if let Some(session) = inner.sessions.get(window.label()) {
                if session.restoring {
                    return Err(
                        "The room window is still being restored. Please retry shortly.".into(),
                    );
                }
                return Ok(session.viewport.clone());
            }
            if !inner.sessions.is_empty() {
                return Err(
                    "Another avatar is already on the desktop. Return it to its room first.".into(),
                );
            }
            inner
                .room_min_widths
                .get(window.label())
                .copied()
                .unwrap_or(crate::MAIN_WINDOW_MIN_WIDTH)
        };
        let room = RoomWindow {
            position: window.outer_position().map_err(|e| e.to_string())?,
            size: window.inner_size().map_err(|e| e.to_string())?,
            min_width,
            decorated: window.is_decorated().map_err(|e| e.to_string())?,
            resizable: window.is_resizable().map_err(|e| e.to_string())?,
            maximizable: window.is_maximizable().map_err(|e| e.to_string())?,
            always_on_top: window.is_always_on_top().map_err(|e| e.to_string())?,
        };
        let monitor = choose_monitor(&window, preferred_monitor.as_deref())?;
        let viewport = viewport(&monitor);
        let area = monitor.work_area();
        // Reserve the room and its recovery snapshot before the first native mutation.
        // Side-panel resize requests now see an active mode; the poller skips transitions.
        state
            .inner
            .lock()
            .map_err(|_| "Desktop state is unavailable.")?
            .sessions
            .insert(
                window.label().into(),
                Session {
                    room: room.clone(),
                    viewport: viewport.clone(),
                    origin: area.position,
                    size: area.size,
                    regions: Vec::new(),
                    dragging: false,
                    ignoring: true,
                    heartbeat: Instant::now(),
                    restoring: false,
                    transitioning: true,
                },
            );
        let change = || -> tauri::Result<()> {
            window.set_ignore_cursor_events(true)?;
            window.set_min_size(None::<tauri::LogicalSize<f64>>)?;
            window.set_decorations(false)?;
            window.set_shadow(false)?;
            window.set_resizable(false)?;
            window.set_maximizable(false)?;
            window.set_always_on_top(true)?;
            window.set_position(area.position)?;
            window.set_size(area.size)?;
            window.show()
        };
        if let Err(error) = change() {
            let restore = restore_window(&window, &room);
            if let Ok(mut inner) = state.inner.lock() {
                if restore.is_ok() {
                    inner.sessions.remove(window.label());
                } else if let Some(session) = inner.sessions.get_mut(window.label()) {
                    session.transitioning = false;
                    session.restoring = true;
                }
            }
            if restore.is_err() {
                start_worker(app.clone());
            }
            return Err(format!(
                "Could not enter desktop mode: {error}{}",
                restore
                    .err()
                    .map(|e| format!("; recovery: {e}"))
                    .unwrap_or_default()
            ));
        }
        if let Some(session) = state
            .inner
            .lock()
            .map_err(|_| "Desktop state is unavailable.")?
            .sessions
            .get_mut(window.label())
        {
            session.transitioning = false;
            session.heartbeat = Instant::now();
        }
        start_worker(app.clone());
        Ok(viewport)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn exit_desktop_mode(window: WebviewWindow) -> Result<(), String> {
    allowed(&window)?;
    tauri::async_runtime::spawn_blocking(move || exit_inner(&window, "return-to-room"))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn update_desktop_hit_regions(
    window: WebviewWindow,
    regions: Vec<HitRegion>,
    dragging: bool,
) -> Result<(), String> {
    allowed(&window)?;
    if regions.len() > 32 || regions.iter().any(|region| !region.valid()) {
        return Err("Invalid desktop interaction regions.".into());
    }
    let state = window.state::<DesktopModeState>();
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Desktop state is unavailable.")?;
    let session = inner
        .sessions
        .get_mut(window.label())
        .ok_or("Desktop mode is no longer active.")?;
    session.regions = regions;
    session.dragging = dragging;
    session.heartbeat = Instant::now();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn desktop_session() -> Session {
        Session {
            room: RoomWindow {
                position: PhysicalPosition::new(0, 0),
                size: PhysicalSize::new(760, 520),
                min_width: 720.0,
                decorated: true,
                resizable: false,
                maximizable: false,
                always_on_top: false,
            },
            viewport: DesktopViewport {
                width: 1280.0,
                height: 720.0,
                scale_factor: 2.0,
                monitor_id: "test-display".into(),
            },
            origin: PhysicalPosition::new(-2560, 48),
            size: PhysicalSize::new(2560, 1440),
            regions: vec![HitRegion {
                x: 50.0,
                y: 20.0,
                width: 40.0,
                height: 60.0,
            }],
            dragging: false,
            ignoring: true,
            heartbeat: Instant::now(),
            restoring: false,
            transitioning: false,
        }
    }

    #[test]
    fn hit_regions_use_logical_coordinates_on_negative_origin_retina_display() {
        let session = desktop_session();
        assert!(!should_ignore(
            &session,
            PhysicalPosition::new(-2440.0, 108.0)
        ));
        assert!(should_ignore(
            &session,
            PhysicalPosition::new(-2380.0, 108.0)
        ));
        assert!(should_ignore(
            &session,
            PhysicalPosition::new(-2440.0, 208.0)
        ));
        assert!(should_ignore(&session, PhysicalPosition::new(100.0, 100.0)));
    }

    #[test]
    fn drag_retains_capture_outside_sprite_and_empty_canvas_passes_through() {
        let mut session = desktop_session();
        session.dragging = true;
        assert!(!should_ignore(
            &session,
            PhysicalPosition::new(100.0, 100.0)
        ));
        session.dragging = false;
        session.regions.clear();
        assert!(should_ignore(
            &session,
            PhysicalPosition::new(-2440.0, 108.0)
        ));
    }

    #[test]
    fn reject_nonfinite_and_unbounded_hit_regions() {
        let mut region = HitRegion {
            x: 0.0,
            y: 0.0,
            width: 10.0,
            height: 10.0,
        };
        assert!(region.valid());
        region.x = f64::NAN;
        assert!(!region.valid());
        region.x = 0.0;
        region.width = -1.0;
        assert!(!region.valid());
        region.width = f64::INFINITY;
        assert!(!region.valid());
    }

    #[test]
    fn disconnected_display_room_returns_inside_remaining_work_area() {
        assert_eq!(
            fit_room_position(
                PhysicalPosition::new(-2400, 100),
                PhysicalSize::new(760, 520),
                PhysicalPosition::new(0, 48),
                PhysicalSize::new(1920, 1032)
            ),
            PhysicalPosition::new(0, 100),
        );
        assert_eq!(
            fit_room_position(
                PhysicalPosition::new(-200, 900),
                PhysicalSize::new(760, 520),
                PhysicalPosition::new(-1280, 24),
                PhysicalSize::new(1280, 696)
            ),
            PhysicalPosition::new(-760, 200),
        );
    }
}
