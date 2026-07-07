use std::fmt::Write as _;
use std::hash::{Hash, Hasher};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use tauri::{path::BaseDirectory, Emitter, Manager, Size};

mod codex_discovery;
mod local_bridge;
mod workbuddy_discovery;

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

const MAX_TASK_PROMPT_CHARS: usize = 24_000;

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

fn attach_save_before_close_handler(window: tauri::WebviewWindow) {
    let closing = Arc::new(AtomicBool::new(false));
    let window_for_event = window.clone();
    let closing_for_event = Arc::clone(&closing);

    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            if closing_for_event.load(Ordering::SeqCst) {
                return;
            }

            api.prevent_close();
            closing_for_event.store(true, Ordering::SeqCst);
            let window_for_close = window_for_event.clone();
            let _ = window_for_event.emit("aivatar://save-before-close", ());
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(150));
                let _ = window_for_close.close();
            });
        }
    });
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

    let output = process
        .output()
        .ok()?;

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
    Some((dir.join("aivatar-hook.sh"), dir.join("aivatar-statusline.sh")))
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
    format!("\"{}\"", path_text(path).replace('\\', "/").replace('"', ""))
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
    format!("/bin/sh '{}' status-line", path_text(path).replace('\'', "'\\''"))
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
    let (hook_path, status_line_path) =
        claude_wrapper_paths().ok_or_else(|| "Could not resolve Claude wrapper path.".to_string())?;
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
        env.insert("AIVATAR_LEARNING_ENABLED".to_string(), serde_json::json!("1"));
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
    let target =
        opencode_plugin_path().ok_or_else(|| "Could not resolve opencode plugin path.".to_string())?;
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
    let node_value = resolve_command("node").map(|path| path_text(&path)).unwrap_or_default();
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
            "Aivatar Claude hooks are incomplete; repair to restore Chat and Cowork tracking.".to_string()
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
        .map(|path| path.join("Programs").join("@opencode-aidesktop").join("OpenCode.exe").is_file())
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
        return Err(
            "Aivatar connected CLI runner was not found in the app resources.".to_string(),
        );
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
    let min_size = Size::Logical(tauri::LogicalSize {
        width: min_width,
        height: 500.0,
    });
    let size = Size::Logical(tauri::LogicalSize { width, height });

    window
        .set_min_size(Some(min_size))
        .map_err(|error| format!("Could not set window minimum size: {error}"))?;
    window
        .set_size(size)
        .map_err(|error| format!("Could not resize window: {error}"))?;

    Ok(())
}

#[tauri::command]
async fn open_save_slot_window(
    app: tauri::AppHandle,
    request: SaveSlotWindowRequest,
) -> Result<SaveSlotWindowResult, String> {
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
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App(std::path::PathBuf::from(url)),
    )
    .title(title)
    .inner_size(760.0, 520.0)
    .min_inner_size(720.0, 500.0)
    .resizable(false)
    .always_on_top(false)
    .decorations(true)
    .focused(true)
    .build()
    .map_err(|error| format!("Could not open save window: {error}"))?;

    attach_save_before_close_handler(window);

    Ok(SaveSlotWindowResult { label })
}

#[tauri::command]
async fn open_card_room_window(
    app: tauri::AppHandle,
    request: CardRoomWindowRequest,
) -> Result<CardRoomWindowResult, String> {
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

    let url = format!(
        "./?view=card-room&hostSlotId={}",
        url_component(host_slot_id)
    );
    tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App(std::path::PathBuf::from(url)),
    )
    .title("Aivatar - Card Room")
    .inner_size(1180.0, 900.0)
    .min_inner_size(1180.0, 900.0)
    .resizable(false)
    .always_on_top(false)
    .decorations(true)
    .focused(true)
    .build()
    .map_err(|error| format!("Could not open card room: {error}"))?;

    Ok(CardRoomWindowResult { label })
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

fn social_room_memory_path(app: &tauri::AppHandle, key: &str) -> Result<std::path::PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?
        .join("social-room-memory");
    Ok(directory.join(format!("{}.json", safe_social_room_memory_key(key))))
}

#[tauri::command]
fn read_social_room_memory(
    app: tauri::AppHandle,
    key: String,
) -> Result<Option<String>, String> {
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
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            start_status_bridge,
            pick_markdown_task_file,
            pick_launcher_directory,
            start_agent_cli,
            start_task_agent,
            resize_main_window_for_side_panel,
            open_save_slot_window,
            open_card_room_window,
            get_agent_integrations,
            enable_agent_integration,
            read_social_room_memory,
            write_social_room_memory
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                attach_save_before_close_handler(window);
            }
            let app_handle = app.handle().clone();
            let _ = start_status_bridge_inner(Some(&app_handle));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Aivatar");
}
