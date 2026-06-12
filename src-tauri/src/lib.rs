use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use tauri::{path::BaseDirectory, Emitter, Manager, Size};

mod codex_discovery;
mod local_bridge;

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

const MAX_TASK_PROMPT_CHARS: usize = 24_000;

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
    if let Some(path) = std::env::var_os("AIVATAR_SESSION_PLUGIN_ROOT").map(std::path::PathBuf::from)
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

    let Some(app) = app else {
        return None;
    };

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

    candidates
        .into_iter()
        .find(|path| path.join("scripts").join("aivatar-heartbeat.mjs").is_file())
}

fn scripts_root(app: Option<&tauri::AppHandle>) -> Option<std::path::PathBuf> {
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

    let Some(app) = app else {
        return None;
    };

    let mut candidates = Vec::new();
    if let Ok(path) = app.path().resolve("../scripts", BaseDirectory::Resource) {
        candidates.push(path);
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("_up_").join("scripts"));
        candidates.push(resource_dir.join("scripts"));
    }

    candidates
        .into_iter()
        .find(|path| path.join("aivatar-connected-run.mjs").is_file())
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
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(std::path::PathBuf::from)
        .find(|path| path.is_file())
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
        return Ok(BridgeStartResult {
            status: "already-running".to_string(),
            message: "Bridge already running.".to_string(),
        });
    }

    local_bridge::start()?;
    let _ = codex_discovery::start(learning_script);

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

fn posix_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r#"'\''"#))
}

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            start_status_bridge,
            pick_markdown_task_file,
            pick_launcher_directory,
            start_agent_cli,
            start_task_agent,
            resize_main_window_for_side_panel
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
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
            let app_handle = app.handle().clone();
            let _ = start_status_bridge_inner(Some(&app_handle));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Aivatar");
}
