//! Bounded, single-delivery learning jobs shared by native integrations.
use std::{fs::OpenOptions, io::{Read, Write}, path::PathBuf, process::{Command, Stdio}, thread, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use serde_json::{json, Value};

#[derive(Clone)]
pub(crate) struct LearningJob {
    pub learning_script: Option<PathBuf>,
    pub provider: String,
    pub agent: String,
    pub session_id: String,
    pub status: String,
    pub summary: String,
    pub digest: String,
    pub learning_id: String,
}

fn known_provider(provider: &str) -> bool {
    matches!(provider, "codex" | "claude-code" | "opencode" | "codebuddy")
}

fn reason_allowed(reason: &str) -> bool {
    matches!(reason, "unavailable" | "authentication" | "timeout" | "invalid-output" | "empty-candidates" | "incompatible-client" | "invalid-schema" | "provider-error")
}

fn fallback(job: &LearningJob, reason: &str) -> Value {
    let mut result = json!({
        "id": job.learning_id, "source": "heuristic",
        "summary": "Aivatar noticed the end of a task.",
        "idleBubbleCandidates": ["又学会了一点点", "慢慢来就很好"],
        "socialBubbleCandidates": [], "traitChanges": {},
        "xp": 1, "confidence": 0.2, "privacyRisk": "low"
    });
    if job.provider != "none" {
        result["diagnostic"] = json!({
            "provider": if known_provider(&job.provider) { job.provider.as_str() } else if job.agent == "workbuddy" { "codebuddy" } else { job.agent.as_str() }, "status": "fallback",
            "reason": if reason_allowed(reason) { reason } else { "provider-error" },
            "timestamp": chrono::Utc::now().to_rfc3339()
        });
    }
    result
}

fn payload(job: &LearningJob, learning: Value) -> Value {
    let error = job.status == "error";
    json!({
        "agent": job.agent, "sessionId": job.session_id,
        "status": if error { "error" } else { "complete" },
        "phase": "session-learning", "summary": learning["summary"],
        "message": learning["summary"], "progress": if error { 50 } else { 100 },
        "severity": if error { "error" } else { "info" },
        "timestamp": chrono::Utc::now().to_rfc3339(), "learning": learning
    })
}

fn worker_result(job: &LearningJob, output: &[u8]) -> Result<Value, &'static str> {
    if output.len() > 1024 * 1024 { return Err("invalid-output"); }
    let result: Value = serde_json::from_slice(output).map_err(|_| "invalid-output")?;
    if !matches!(result["source"].as_str(), Some("llm" | "heuristic"))
        || !result["summary"].is_string() || !result["idleBubbleCandidates"].is_array()
        || !matches!(result["privacyRisk"].as_str(), Some("low" | "medium" | "high")) {
        return Err("invalid-output");
    }
    if known_provider(&job.provider) {
        let diagnostic = &result["diagnostic"];
        if diagnostic["provider"].as_str() != Some(job.provider.as_str())
            || !matches!(diagnostic["status"].as_str(), Some("success" | "fallback"))
            || (diagnostic["status"] == "fallback" && !diagnostic["reason"].as_str().is_some_and(reason_allowed))
            || (result["source"] == "llm" && diagnostic["status"] != "success") {
            return Err("invalid-output");
        }
    }
    let short = |value: &Value, limit: usize| value.as_str().unwrap_or_default().chars()
        .filter(|ch| !ch.is_control()).take(limit).collect::<String>();
    let mut traits = serde_json::Map::new();
    for key in ["focus", "resilience", "curiosity", "efficiency", "creativity", "warmth"] {
        if let Some(value) = result["traitChanges"][key].as_f64().filter(|value| value.is_finite()) {
            traits.insert(key.into(), json!(value.round().clamp(-1.0, 3.0) as i64));
        }
    }
    let phrases: Vec<_> = result["idleBubbleCandidates"].as_array().unwrap().iter()
        .filter(|value| value.is_string()).take(8).map(|value| short(value, 28)).collect();
    let socials: Vec<_> = result["socialBubbleCandidates"].as_array().into_iter().flatten().take(6)
        .filter(|value| value.is_object()).map(|value| {
            let mut object = serde_json::Map::new();
            for (key, limit) in [("kind", 12), ("text", 56), ("locale", 8), ("intentId", 40), ("activity", 32)] {
                if value[key].is_string() { object.insert(key.into(), json!(short(&value[key], limit))); }
            }
            for (key, count, limit) in [("replyToIntentIds", 4, 40), ("allowedVisitRoles", 2, 12), ("tags", 4, 18)] {
                let items: Vec<_> = value[key].as_array().into_iter().flatten().filter(|item| item.is_string())
                    .take(count).map(|item| short(item, limit)).collect();
                object.insert(key.into(), json!(items));
            }
            Value::Object(object)
        }).collect();
    let mut clean = json!({
        "id": job.learning_id, "source": result["source"], "summary": short(&result["summary"], 220),
        "idleBubbleCandidates": phrases, "socialBubbleCandidates": socials, "traitChanges": traits,
        "xp": result["xp"].as_f64().unwrap_or(1.0).round().clamp(1.0, 8.0),
        "confidence": result["confidence"].as_f64().unwrap_or(0.2).clamp(0.0, 1.0),
        "privacyRisk": result["privacyRisk"]
    });
    if known_provider(&job.provider) {
        let mut diagnostic = json!({ "provider": job.provider, "status": result["diagnostic"]["status"], "timestamp": chrono::Utc::now().to_rfc3339() });
        if result["diagnostic"]["status"] == "fallback" { diagnostic["reason"] = result["diagnostic"]["reason"].clone(); }
        clean["diagnostic"] = diagnostic;
    }
    Ok(clean)
}

fn stop_child_tree(child: &mut std::process::Child) {
    // Only target the group/tree created for this job, never a provider process
    // discovered elsewhere on the machine.
    #[cfg(unix)] {
        let _ = Command::new("/bin/kill").args(["-KILL", "--", &format!("-{}", child.id())])
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
    #[cfg(target_os = "windows")] {
        use std::os::windows::process::CommandExt;
        if let Ok(mut killer) = Command::new("taskkill.exe")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(0x08000000).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn() {
            let deadline = Instant::now() + Duration::from_secs(2);
            while matches!(killer.try_wait(), Ok(None)) && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(20));
            }
            let _ = killer.kill();
            let _ = killer.wait();
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn run(job: &LearningJob) -> Result<Value, &'static str> {
    run_with_timeout(job, Duration::from_secs(120))
}

fn run_with_timeout(job: &LearningJob, timeout: Duration) -> Result<Value, &'static str> {
    let script = job.learning_script.as_ref().filter(|path| path.is_file()).ok_or("unavailable")?;
    let node = crate::codex_discovery::resolve_learning_command("node").ok_or("unavailable")?;
    let mut command = Command::new(node);
    command.arg(script).args([
        "--provider", &job.provider, "--agent", &job.agent,
        "--session", &job.session_id, "--status", &job.status,
        "--summary", &job.summary, "--learning-id", &job.learning_id, "--dry-run",
    ]);
    if !job.digest.is_empty() {
        let directory = std::env::temp_dir().join("aivatar-learning-context");
        std::fs::create_dir_all(&directory).map_err(|_| "provider-error")?;
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
        let path = directory.join(format!("learning-job-{}-{stamp}.txt", std::process::id()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let mut file = options.open(&path).map_err(|_| "provider-error")?;
        let digest: String = job.digest.chars().take(2400).collect();
        file.write_all(digest.as_bytes()).map_err(|_| "provider-error")?;
        command.arg("--context-file").arg(path);
    }
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(unix)] {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(target_os = "windows")] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|_| "unavailable")?;
    let stdout = child.stdout.take().ok_or("provider-error")?;
    let (sender, receiver) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout.take(1024 * 1024 + 1).read_to_end(&mut bytes).map(|_| bytes);
        let _ = sender.send(result);
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(25)),
            Ok(None) => { stop_child_tree(&mut child); break Err("timeout"); }
            Err(_) => { stop_child_tree(&mut child); break Err("provider-error"); }
        }
    };
    // Do not block on a leaked pipe after timeout; the reader exits when the
    // inherited handle is closed, independently of the discovery thread.
    let status = status?;
    if !status.success() { stop_child_tree(&mut child); return Err("provider-error"); }
    let output = match receiver.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        Ok(result) => result.map_err(|_| "provider-error")?,
        Err(_) => { stop_child_tree(&mut child); return Err("timeout"); }
    };
    worker_result(job, &output)
}

pub(crate) fn start(job: LearningJob) -> bool {
    let rescue = job.clone();
    match thread::Builder::new().name("aivatar-learning-job".to_string()).spawn(move || {
        let learning = run(&job).unwrap_or_else(|reason| fallback(&job, reason));
        let _ = crate::local_bridge::submit_status(payload(&job, learning));
    }) {
        Ok(_) => true,
        Err(_) => {
            let _ = crate::local_bridge::submit_status(payload(&rescue, fallback(&rescue, "provider-error")));
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn job() -> LearningJob { LearningJob { learning_script: None, provider: "codebuddy".into(), agent: "workbuddy".into(), session_id: "synthetic".into(), status: "complete".into(), summary: "Task ended".into(), digest: String::new(), learning_id: "round-1".into() } }
    #[test]
    fn missing_worker_is_a_safe_fallback() {
        let job = job();
        assert_eq!(run(&job).unwrap_err(), "unavailable");
        let result = fallback(&job, "private raw error");
        assert_eq!(result["diagnostic"]["reason"], "provider-error");
        assert_eq!(result["id"], "round-1");
        assert!(!result.to_string().contains("private raw error"));
    }
    #[test]
    fn result_uses_the_round_id_and_learning_only_phase() {
        let job = job();
        let mut result = fallback(&job, "timeout");
        result["id"] = json!("model-provided-id");
        result["privateExtra"] = json!("secret");
        result["diagnostic"]["rawError"] = json!("private raw failure");
        let parsed = worker_result(&job, &serde_json::to_vec(&result).unwrap()).unwrap();
        assert_eq!(parsed["id"], "round-1");
        assert!(parsed.get("privateExtra").is_none());
        assert!(parsed["diagnostic"].get("rawError").is_none());
        let status = payload(&job, parsed);
        assert_eq!(status["phase"], "session-learning");
        assert_eq!(status["agent"], "workbuddy");
        assert!(status.get("usage").is_none());
    }
    #[test]
    fn malformed_or_wrong_provider_result_cannot_count_as_success() {
        let job = job();
        assert_eq!(worker_result(&job, b"{}").unwrap_err(), "invalid-output");
        let mut result = fallback(&job, "unavailable");
        result["diagnostic"]["provider"] = json!("codex");
        assert!(worker_result(&job, &serde_json::to_vec(&result).unwrap()).is_err());
    }

    fn fixture(source: &str) -> LearningJob {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let directory = std::env::temp_dir().join(format!("aivatar-native-job-test-{}-{stamp}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("synthetic-worker.mjs");
        std::fs::write(&path, source).unwrap();
        LearningJob { learning_script: Some(path), ..job() }
    }
    #[test]
    fn real_child_crash_and_malformed_output_are_reported() {
        if crate::codex_discovery::resolve_learning_command("node").is_none() { return; }
        assert_eq!(run_with_timeout(&fixture("process.exitCode=1"), Duration::from_secs(3)).unwrap_err(), "provider-error");
        assert_eq!(run_with_timeout(&fixture("console.log('not json')"), Duration::from_secs(3)).unwrap_err(), "invalid-output");
    }
    #[test]
    fn real_child_timeout_is_bounded_even_when_term_is_ignored() {
        if crate::codex_discovery::resolve_learning_command("node").is_none() { return; }
        let started = Instant::now();
        let job = fixture("process.on('SIGTERM',()=>{});setInterval(()=>{},1000)");
        assert_eq!(run_with_timeout(&job, Duration::from_millis(200)).unwrap_err(), "timeout");
        assert!(started.elapsed() < Duration::from_secs(4));
    }
    #[cfg(unix)]
    #[test]
    fn inherited_stdout_does_not_hold_a_completed_job_open() {
        if crate::codex_discovery::resolve_learning_command("node").is_none() { return; }
        let job = fixture("import{spawn}from'node:child_process';const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','ignore']});c.unref();process.exit(0)");
        let started = Instant::now();
        assert_eq!(run_with_timeout(&job, Duration::from_millis(250)).unwrap_err(), "timeout");
        assert!(started.elapsed() < Duration::from_secs(4));
    }
}
