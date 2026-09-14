use super::*;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};

const TEST_SESSION: &str = "synthetic-codex-session";
static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

// These fixtures contain synthetic events only. Keep them for inspection;
// the test suite never opens real session folders or deletes files.
fn fixture(bytes: &[u8]) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let sequence = FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let directory = std::env::temp_dir().join(format!(
        "aivatar-codex-regression-{}-{nonce}-{sequence}",
        std::process::id()
    ));
    fs::create_dir(&directory).unwrap();
    let path = directory.join("synthetic.jsonl");
    fs::write(&path, bytes).unwrap();
    path
}

fn append(path: &Path, bytes: &[u8]) {
    let mut file = OpenOptions::new().append(true).open(path).unwrap();
    file.write_all(bytes).unwrap();
}

fn watched(path: PathBuf) -> WatchedSession {
    WatchedSession {
        path,
        ..WatchedSession::default()
    }
}

fn record(kind: &str, payload: Value, second: u8) -> Value {
    json!({
        "type": kind,
        "timestamp": format!("2026-09-05T12:00:{second:02}Z"),
        "payload": payload
    })
}

fn event(kind: &str, turn: Option<&str>, second: u8) -> Value {
    let mut payload = json!({"type": kind});
    if let Some(turn) = turn {
        payload["turn_id"] = json!(turn);
    }
    record("event_msg", payload, second)
}

fn usage(total: u64, turn: Option<&str>, second: u8) -> Value {
    let mut result = event("token_count", turn, second);
    result["payload"]["info"] = json!({
        "total_token_usage": {"total_tokens": total, "input_tokens": total},
        "last_token_usage": {"total_tokens": 10, "input_tokens": 10},
        "model_context_window": 200_000
    });
    result
}

fn final_message(kind: &str, phase: &str, second: u8) -> Value {
    let payload = if kind == "response_item" {
        json!({"type": "message", "role": "assistant", "phase": phase,
            "content": [{"type": "output_text", "text": "Synthetic task finished"}]})
    } else {
        json!({"type": "agent_message", "phase": phase, "message": "Synthetic task finished"})
    };
    record(kind, payload, second)
}

fn apply(session: &mut WatchedSession, record: &Value) -> Option<Value> {
    status_from_record(TEST_SESSION, session, record, false)
}

fn json_line(record: &Value) -> Vec<u8> {
    let mut bytes = serde_json::to_vec(record).unwrap();
    bytes.push(b'\n');
    bytes
}

fn collect(session: &mut WatchedSession) -> Vec<Value> {
    let mut statuses = Vec::new();
    read_session_updates(TEST_SESSION, session, false, |status| statuses.push(status)).unwrap();
    statuses
}

#[test]
fn official_completion_aliases_finish_without_a_final_message() {
    for terminal in ["task_complete", "turn_complete"] {
        let mut session = WatchedSession::default();
        apply(&mut session, &event("task_started", Some("A"), 1)).unwrap();
        let mut complete = event(terminal, Some("A"), 2);
        complete["payload"]["last_agent_message"] = json!("Finished synthetic lifecycle");
        let status = apply(&mut session, &complete).unwrap();
        assert_eq!(status["status"], "complete");
        assert_eq!(status["message"], "Finished synthetic lifecycle");
        assert_eq!(status["turnId"], "A");
        assert!(session.terminal_turn_ended);
    }
}

#[test]
fn aborted_and_failed_turns_stop_without_success_rewards_or_learning() {
    let interrupted = event("turn_aborted", Some("A"), 2);
    let mut failed = event("task_complete", Some("A"), 2);
    failed["payload"]["error"] = json!({"message": "Synthetic failure"});
    for terminal in [interrupted, failed] {
        let mut session = WatchedSession::default();
        apply(&mut session, &event("task_started", Some("A"), 1));
        let status = apply(&mut session, &terminal).unwrap();
        assert_eq!(status["status"], "error");
        assert_eq!(status["severity"], "error");
        assert!(status.get("rewardId").is_none());
        assert!(status.get("usage").is_none());
        assert!(status.get("learning").is_none());
        assert!(session.terminal_turn_ended);
    }
}

#[test]
fn final_formats_and_official_completion_settle_each_turn_once() {
    for kind in ["event_msg", "response_item"] {
        for phase in ["final", "final_answer"] {
            let mut session = WatchedSession::default();
            apply(&mut session, &usage(100, None, 0));
            apply(&mut session, &event("task_started", Some("A"), 1));
            apply(&mut session, &usage(160, Some("A"), 2));
            let first = apply(&mut session, &final_message(kind, phase, 3)).unwrap();
            assert_eq!(first["status"], "complete");
            assert_eq!(first["usage"]["totalTokens"], 60);
            for duplicate in [
                final_message("event_msg", "final", 4),
                final_message("response_item", "final_answer", 5),
                event("task_complete", Some("A"), 6),
                event("turn_complete", Some("A"), 7),
            ] {
                assert!(apply(&mut session, &duplicate).is_none());
            }
            apply(&mut session, &event("task_started", Some("B"), 8)).unwrap();
            apply(&mut session, &usage(190, Some("B"), 9));
            let next = apply(&mut session, &event("task_complete", Some("B"), 10)).unwrap();
            assert_eq!(next["usage"]["totalTokens"], 30);
            assert_ne!(first["rewardId"], next["rewardId"]);
            assert_eq!(next["turnId"], "B");
        }
    }
}

#[test]
fn unphased_agent_message_waits_for_official_completion() {
    let mut session = WatchedSession::default();
    apply(&mut session, &event("task_started", Some("A"), 1));
    let unphased = record(
        "event_msg",
        json!({"type": "agent_message", "message": "Synthetic reply"}),
        2,
    );
    assert!(apply(&mut session, &unphased).is_none());
    assert!(!session.terminal_turn_ended);
    assert_eq!(
        apply(&mut session, &event("task_complete", Some("A"), 3)).unwrap()["status"],
        "complete"
    );
}

#[test]
fn task_started_user_message_and_steering_share_one_usage_baseline() {
    for user_first in [false, true] {
        let mut session = WatchedSession::default();
        apply(&mut session, &usage(100, None, 0));
        let first = if user_first {
            event("user_message", None, 1)
        } else {
            event("task_started", Some("A"), 1)
        };
        apply(&mut session, &first);
        apply(&mut session, &usage(110, None, 2));
        let second = if user_first {
            event("task_started", Some("A"), 3)
        } else {
            event("user_message", None, 3)
        };
        apply(&mut session, &second);
        apply(&mut session, &event("user_message", None, 4));
        apply(&mut session, &usage(160, Some("A"), 5));
        let status = apply(&mut session, &event("task_complete", Some("A"), 6)).unwrap();
        assert_eq!(status["usage"]["scope"], "since-baseline");
        assert_eq!(
            status["usage"]["totalTokens"], 60,
            "user_first={user_first}"
        );
    }
}

#[test]
fn terminal_telemetry_updates_the_next_baseline_without_reopening() {
    for telemetry_turn in [None, Some("A")] {
        let mut session = WatchedSession::default();
        apply(&mut session, &usage(100, None, 0));
        apply(&mut session, &event("task_started", Some("A"), 1));
        apply(&mut session, &usage(150, Some("A"), 2));
        apply(&mut session, &final_message("event_msg", "final", 3));
        assert!(apply(&mut session, &usage(170, telemetry_turn, 4)).is_none());
        assert!(session.terminal_turn_ended);
        assert_eq!(
            session.latest_usage.as_ref().unwrap().total.total_tokens,
            170
        );
        apply(&mut session, &event("task_started", Some("B"), 5));
        apply(&mut session, &usage(200, Some("B"), 6));
        let status = apply(&mut session, &event("task_complete", Some("B"), 7)).unwrap();
        assert_eq!(status["usage"]["totalTokens"], 30);
    }
}

#[test]
fn late_old_turn_events_cannot_end_or_reset_a_new_turn() {
    let mut session = WatchedSession::default();
    apply(&mut session, &event("task_started", Some("A"), 1));
    apply(&mut session, &final_message("event_msg", "final", 2));
    apply(&mut session, &event("task_started", Some("B"), 3));
    for kind in [
        "task_complete",
        "turn_complete",
        "turn_aborted",
        "task_started",
        "user_message",
    ] {
        assert!(
            apply(&mut session, &event(kind, Some("A"), 4)).is_none(),
            "{kind}"
        );
        assert!(!session.terminal_turn_ended);
        assert_eq!(session.turn_id.as_deref(), Some("B"));
    }
    let mut stale = final_message("event_msg", "final", 2);
    stale["payload"]["turn_id"] = json!("A");
    assert!(apply(&mut session, &stale).is_none());
    assert_eq!(
        apply(&mut session, &event("task_complete", Some("B"), 5)).unwrap()["status"],
        "complete"
    );
}

#[test]
fn legacy_final_ignores_late_tool_activity_and_accepts_a_new_user_turn() {
    let mut session = WatchedSession::default();
    apply(&mut session, &event("user_message", None, 1));
    apply(&mut session, &final_message("event_msg", "final", 2));
    for tool_type in [
        "function_call",
        "function_call_output",
        "custom_tool_call",
        "custom_tool_call_output",
    ] {
        let late = record(
            "response_item",
            json!({"type": tool_type, "name": "synthetic-tool"}),
            3,
        );
        assert!(apply(&mut session, &late).is_none());
        assert!(session.terminal_turn_ended);
    }
    let commentary = record(
        "event_msg",
        json!({"type": "agent_message", "phase": "commentary", "message": "Synthetic late commentary"}),
        4,
    );
    assert!(apply(&mut session, &commentary).is_none());
    assert_eq!(
        apply(&mut session, &event("user_message", None, 5)).unwrap()["status"],
        "thinking"
    );
    assert!(!session.terminal_turn_ended);
    assert_eq!(
        apply(&mut session, &final_message("event_msg", "final", 6)).unwrap()["status"],
        "complete"
    );
}

#[test]
fn split_utf8_terminal_record_is_committed_only_after_its_newline() {
    let mut terminal = final_message("event_msg", "final", 2);
    terminal["payload"]["message"] = json!("合成任务已完成");
    let line = json_line(&terminal);
    let split = line
        .windows("合".len())
        .position(|part| part == "合".as_bytes())
        .unwrap()
        + 1;
    let start = json_line(&event("user_message", None, 1));
    let path = fixture(&start);
    let mut session = watched(path.clone());
    assert_eq!(collect(&mut session).len(), 1);
    append(&path, &line[..split]);
    assert!(collect(&mut session).is_empty());
    assert_eq!(session.offset, start.len() as u64);
    append(&path, &line[split..split + 1]);
    assert!(collect(&mut session).is_empty());
    append(&path, &line[split + 1..line.len() - 1]);
    assert!(collect(&mut session).is_empty());
    append(&path, b"\n");
    let statuses = collect(&mut session);
    assert_eq!(statuses.len(), 1);
    assert_eq!(statuses[0]["status"], "complete");
    assert_eq!(statuses[0]["message"], "合成任务已完成");
    assert_eq!(session.offset, (start.len() + line.len()) as u64);
    assert!(collect(&mut session).is_empty());
}

#[test]
fn long_records_across_polls_preserve_the_following_completion() {
    let start = json_line(&event("task_started", Some("A"), 1));
    let long_tool = json_line(&record(
        "response_item",
        json!({"type": "function_call_output", "output": "x".repeat(40_000)}),
        2,
    ));
    let mut long_final = final_message("event_msg", "final", 3);
    long_final["payload"]["message"] = json!("y".repeat(40_000));
    let final_line = json_line(&long_final);
    let path = fixture(&start);
    let mut session = watched(path.clone());
    collect(&mut session);
    append(&path, &long_tool[..35_000]);
    assert!(collect(&mut session).is_empty());
    assert_eq!(session.offset, start.len() as u64);
    append(&path, &long_tool[35_000..]);
    append(&path, &final_line);
    let statuses = collect(&mut session);
    assert_eq!(statuses.len(), 2);
    assert_eq!(statuses[0]["phase"], "tool-result");
    assert_eq!(statuses[1]["status"], "complete");
    assert!(statuses[1]["message"].as_str().unwrap().len() < 200);
}

#[test]
fn startup_restore_leaves_a_partial_terminal_for_the_next_poll() {
    let start = json_line(&event("task_started", Some("A"), 1));
    let terminal = json_line(&event("task_complete", Some("A"), 2));
    let split = terminal.len() / 2;
    let mut bytes = start.clone();
    bytes.extend_from_slice(&terminal[..split]);
    let path = fixture(&bytes);
    let mut session = watched(path.clone());
    assert_eq!(
        restore_latest_status(TEST_SESSION, &mut session).unwrap()["status"],
        "thinking"
    );
    assert_eq!(session.offset, start.len() as u64);
    append(&path, &terminal[split..]);
    let statuses = collect(&mut session);
    assert_eq!(statuses.len(), 1);
    assert_eq!(statuses[0]["status"], "complete");
    assert!(collect(&mut session).is_empty());
}

#[test]
fn append_during_a_snapshot_is_read_exactly_once_by_the_next_poll() {
    let start = json_line(&event("task_started", Some("A"), 1));
    let terminal = json_line(&event("task_complete", Some("A"), 2));
    let path = fixture(&start);
    let mut session = watched(path.clone());
    let mut statuses = Vec::new();
    read_session_updates(TEST_SESSION, &mut session, false, |status| {
        statuses.push(status);
        append(&path, &terminal);
    })
    .unwrap();
    assert_eq!(statuses.len(), 1);
    assert_eq!(session.offset, start.len() as u64);
    let next = collect(&mut session);
    assert_eq!(next.len(), 1);
    assert_eq!(next[0]["status"], "complete");
    assert!(collect(&mut session).is_empty());
}

#[test]
fn truncation_restore_discards_old_partial_data_and_turn_state() {
    let old_start = json_line(&event("task_started", Some("A"), 1));
    let padding = json_line(&record(
        "response_item",
        json!({"type": "function_call_output", "output": "x".repeat(4_000)}),
        2,
    ));
    let mut bytes = old_start;
    bytes.extend_from_slice(&padding);
    bytes.extend_from_slice(b"{\"type\":\"event_msg\",\"payload\":");
    let path = fixture(&bytes);
    let mut session = watched(path.clone());
    collect(&mut session);
    let mut replacement = json_line(&event("task_started", Some("B"), 3));
    replacement.extend_from_slice(&json_line(&event("task_complete", Some("B"), 4)));
    assert!(replacement.len() < session.offset as usize);
    // The file was created by this test, so replacing its synthetic contents is safe.
    fs::write(&path, &replacement).unwrap();
    assert!(read_session_updates(TEST_SESSION, &mut session, false, |_| {}).is_err());
    let restored = restore_latest_status(TEST_SESSION, &mut session).unwrap();
    assert_eq!(restored["status"], "complete");
    assert_eq!(restored["turnId"], "B");
    assert_eq!(session.offset, replacement.len() as u64);
    assert!(collect(&mut session).is_empty());
}

#[test]
fn malformed_complete_line_does_not_discard_the_next_terminal() {
    let mut bytes = json_line(&event("task_started", Some("A"), 1));
    bytes.extend_from_slice(b"{malformed synthetic record}\n");
    bytes.extend_from_slice(&json_line(&event("task_complete", Some("A"), 2)));
    let mut session = watched(fixture(&bytes));
    let statuses = collect(&mut session);
    assert_eq!(statuses.len(), 2);
    assert_eq!(statuses.last().unwrap()["status"], "complete");
    assert_eq!(session.offset, bytes.len() as u64);
}

#[test]
fn discovery_and_telemetry_alone_do_not_claim_a_running_task() {
    let meta = SessionMeta {
        session_id: TEST_SESSION.to_string(),
        path: PathBuf::from("synthetic-not-opened.jsonl"),
        cwd: None,
        timestamp: None,
    };
    assert_eq!(discovered_status(&meta)["status"], "idle");
    assert_eq!(
        apply(&mut WatchedSession::default(), &usage(100, None, 1)).unwrap()["status"],
        "idle"
    );
}

#[test]
fn restoration_reintroduces_only_the_latest_turn_start_and_status() {
    for finished in [false, true] {
        let mut bytes = json_line(&event("task_started", Some("A"), 1));
        bytes.extend_from_slice(&json_line(&event("task_complete", Some("A"), 2)));
        bytes.extend_from_slice(&json_line(&event("task_started", Some("B"), 3)));
        let latest = if finished {
            event("task_complete", Some("B"), 4)
        } else {
            record(
                "response_item",
                json!({"type": "function_call", "name": "synthetic-tool", "turn_id": "B"}),
                4,
            )
        };
        bytes.extend_from_slice(&json_line(&latest));
        let mut session = watched(fixture(&bytes));
        let restored = restore_latest_status(TEST_SESSION, &mut session).unwrap();
        let updates = restored_status_updates(&session, restored);
        assert_eq!(updates.len(), 2);
        assert_eq!(updates[0]["phase"], "turn-start");
        assert_eq!(updates[0]["status"], "thinking");
        assert_eq!(
            updates[1]["status"],
            if finished { "complete" } else { "executing" }
        );
        assert!(updates.iter().all(|status| status["turnId"] == "B"));
        assert_eq!(
            updates
                .iter()
                .filter(|status| status.get("rewardId").is_some())
                .count(),
            usize::from(finished)
        );
    }
}

#[test]
fn same_known_turn_terminal_wins_even_with_an_older_event_timestamp() {
    let mut session = WatchedSession::default();
    apply(&mut session, &event("task_started", Some("A"), 1));
    let tool = record(
        "response_item",
        json!({"type": "function_call", "name": "synthetic-tool", "turn_id": "A"}),
        3,
    );
    assert_eq!(apply(&mut session, &tool).unwrap()["status"], "executing");
    let terminal = event("task_complete", Some("A"), 2);
    assert_eq!(
        apply(&mut session, &terminal).unwrap()["status"],
        "complete"
    );
    assert!(session.terminal_turn_ended);
    assert!(apply(&mut session, &event("task_complete", Some("A"), 4)).is_none());
}
