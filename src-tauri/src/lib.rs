use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use tauri::{Emitter, Manager, Size};

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

fn is_status_bridge_running() -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], 38988)),
        std::time::Duration::from_millis(350),
    )
    .is_ok()
}

fn start_status_bridge_inner() -> Result<BridgeStartResult, String> {
    if is_status_bridge_running() {
        return Ok(BridgeStartResult {
            status: "already-running".to_string(),
            message: "Bridge already running.".to_string(),
        });
    }

    let root = project_root()?;
    let mut command = std::process::Command::new("npm.cmd");
    command
        .args(["run", "status:bridge"])
        .current_dir(root)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    command
        .spawn()
        .map_err(|error| format!("Could not start bridge: {error}"))?;

    Ok(BridgeStartResult {
        status: "started".to_string(),
        message: "Bridge started.".to_string(),
    })
}

#[tauri::command]
fn start_status_bridge() -> Result<BridgeStartResult, String> {
    start_status_bridge_inner()
}

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

#[tauri::command]
fn pick_markdown_task_file() -> Result<Option<String>, String> {
    run_windows_picker(
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
    )
}

#[tauri::command]
fn pick_launcher_directory() -> Result<Option<String>, String> {
    run_windows_picker(
        r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose CLI launcher folder'
$dialog.ShowNewFolderButton = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.SelectedPath
}
"#,
    )
}

fn powershell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[tauri::command]
fn start_agent_cli(request: AgentCliLaunchRequest) -> Result<AgentCliLaunchResult, String> {
    let cwd = std::path::PathBuf::from(request.cwd.trim());
    if !cwd.is_dir() {
        return Err("Working directory does not exist.".to_string());
    }

    let (agent, command) = match request.agent.as_str() {
        "codex" => ("codex", "codex"),
        "claude-code" => ("claude-code", "claude"),
        _ => return Err("Unsupported agent.".to_string()),
    };

    let _ = start_status_bridge_inner()?;

    let runner = project_root()?
        .join("scripts")
        .join("aivatar-connected-run.mjs");
    let extra_args = request
        .args
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!(" {value}"))
        .unwrap_or_default();
    let new_session_arg = if request.allow_new_session.unwrap_or(false) && agent == "codex" {
        format!(
            " --new-session --expected-cwd {} --verify-desktop-listing",
            powershell_single_quote(&cwd.to_string_lossy())
        )
    } else {
        String::new()
    };
    let wrapped_command = format!(
        "& node {} --agent {}{} -- {}{}",
        powershell_single_quote(&runner.to_string_lossy()),
        powershell_single_quote(agent),
        new_session_arg,
        powershell_single_quote(command),
        extra_args,
    );
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

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        process.creation_flags(0x08000000);
    }

    process
        .spawn()
        .map_err(|error| format!("Could not open agent terminal: {error}"))?;

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
fn start_task_agent(request: TaskAgentLaunchRequest) -> Result<TaskAgentLaunchResult, String> {
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

    let _ = start_status_bridge_inner()?;

    let runner = project_root()?
        .join("scripts")
        .join("aivatar-connected-run.mjs");
    let extra_args = request
        .args
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!(" {value}"))
        .unwrap_or_default();
    let wrapped_command = format!(
        "& node {} --agent {} --session {} --prompt-file {} -- {}{}",
        powershell_single_quote(&runner.to_string_lossy()),
        powershell_single_quote(agent),
        powershell_single_quote(&request.session_id),
        powershell_single_quote(&prompt_path.to_string_lossy()),
        powershell_single_quote(command),
        extra_args,
    );
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

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        process.creation_flags(0x08000000);
    }

    process
        .spawn()
        .map_err(|error| format!("Could not open task agent terminal: {error}"))?;

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
            let _ = start_status_bridge_inner();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Aivatar");
}
