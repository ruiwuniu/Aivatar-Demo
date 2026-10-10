#!/usr/bin/env python3
"""Exercise native-to-JS bridge forwarding with synthetic loopback fixtures.

Imports production Rust modules and the JS bridge's actual JSON response writer.
Only the copied HTTP port changes, so tests never contact the user's bridge.
All generated source and build artifacts stay in the printed temp directory.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile


TESTS = r'''
#[cfg(test)]
mod external_bridge_tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::process::{Child, Command, Stdio};

    struct NodeFixture { child: Child, requests: mpsc::Receiver<String> }
    impl Drop for NodeFixture {
        fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); }
    }
    fn node_fixture() -> NodeFixture {
        let source = NODE_FIXTURE.replace("__FIXTURE_PORT__", &HTTP_PORT.to_string());
        let mut child = Command::new("node").args(["-e", &source])
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, requests) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = tx.send(line);
            }
        });
        let fixture = NodeFixture { child, requests };
        assert_eq!(fixture.requests.recv_timeout(Duration::from_secs(3)).unwrap(), "ready");
        fixture
    }
    fn request(fixture: &NodeFixture) -> Value {
        serde_json::from_str(&fixture.requests.recv_timeout(Duration::from_secs(3)).unwrap()).unwrap()
    }
    fn raw_fixture(reply: Vec<u8>, delay: Duration) -> thread::JoinHandle<()> {
        let listener = TcpListener::bind(("127.0.0.1", HTTP_PORT)).unwrap();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let _ = read_http_request(&mut stream);
            thread::sleep(delay);
            let _ = stream.write_all(&reply);
        })
    }
    fn status(session: &str) -> Value {
        json!({"agent":"workbuddy", "sessionId":session, "status":"complete",
            "summary":"Synthetic task completed", "timestamp":"2026-01-01T00:00:00Z"})
    }

    #[test]
    fn native_discovery_and_learning_reach_the_verified_js_bridge() {
        EXTERNAL_BRIDGE_READY.store(false, Ordering::Release);
        assert!(submit_status(status("before-health")).is_err());
        let fixture = node_fixture();
        verify_existing_bridge().unwrap();
        assert_eq!(request(&fixture)["path"], HEALTH_PATH);
        assert!(BRIDGE_STATE.get().is_none(), "external mode must not create an isolated native state");
        assert_eq!(submit_status(status("synthetic-live")).unwrap(), json!({}));
        let update = request(&fixture);
        assert_eq!(update["path"], AGENT_STATUS_PATH);
        assert_eq!(update["body"]["sessionId"], "synthetic-live");
        submit_presence(json!({"agent":"workbuddy","sessionId":"synthetic-live"})).unwrap();
        assert_eq!(request(&fixture)["path"], PRESENCE_PATH);
        assert!(crate::learning_job::start(crate::learning_job::LearningJob {
            learning_script: None, provider: "codebuddy".into(), agent: "workbuddy".into(),
            session_id: "synthetic-live".into(), status: "complete".into(),
            summary: "Synthetic task completed".into(), digest: String::new(), learning_id: "synthetic-round".into(),
        }));
        let learning = request(&fixture);
        assert_eq!(learning["body"]["phase"], "session-learning");
        assert_eq!(learning["body"]["learning"]["id"], "synthetic-round");
        assert_eq!(learning["body"]["learning"]["diagnostic"]["reason"], "unavailable");
    }

    #[test]
    fn ignored_and_failed_updates_never_look_accepted() {
        let fixture = node_fixture();
        verify_existing_bridge().unwrap(); request(&fixture);
        assert_eq!(submit_status(status("native-200")).unwrap(), json!({}));
        request(&fixture);
        assert_eq!(submit_status(status("ignored")).unwrap()["ignored"], true);
        request(&fixture);
        assert!(submit_status(status("failure")).is_err());
        request(&fixture);
        assert!(submit_status(status("redirect")).is_err());
        request(&fixture);
        assert!(submit_status(status("malformed")).is_err());
        request(&fixture);
    }

    #[test]
    fn posting_requires_a_complete_bounded_json_acknowledgement() {
        let fixture = node_fixture();
        verify_existing_bridge().unwrap(); request(&fixture);
        let started = Instant::now();
        assert!(submit_status(status("headers-only")).is_err());
        assert!(started.elapsed() < Duration::from_secs(2));
        request(&fixture);
    }

    #[test]
    fn unknown_service_cannot_enable_forwarding() {
        EXTERNAL_BRIDGE_READY.store(true, Ordering::Release);
        let body = br#"{"ok":true,"http":"https://untrusted.example/agent-status","websocket":"ws://127.0.0.1:38987/agent-status"}"#;
        let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n", body.len());
        let fixture = raw_fixture([reply.as_bytes(), body].concat(), Duration::ZERO);
        assert!(verify_existing_bridge().is_err()); fixture.join().unwrap();
        assert!(!EXTERNAL_BRIDGE_READY.load(Ordering::Acquire));
        assert!(submit_status(status("blocked")).is_err());
    }

    #[test]
    fn timeouts_and_truncated_health_are_bounded_failures() {
        let fixture = raw_fixture(Vec::new(), Duration::from_millis(250));
        let started = Instant::now();
        assert!(external_bridge_request(HTTP_PORT, "GET", HEALTH_PATH, &[], Duration::from_millis(60)).is_err());
        assert!(started.elapsed() < Duration::from_millis(220));
        fixture.join().unwrap();
        let fixture = raw_fixture(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 40\r\n\r\n{}".to_vec(), Duration::ZERO);
        assert!(external_bridge_request(HTTP_PORT, "GET", HEALTH_PATH, &[], Duration::from_secs(1)).is_err());
        fixture.join().unwrap();
        assert!(external_bridge_request(HTTP_PORT, "POST", AGENT_STATUS_PATH, b"{}", Duration::from_millis(60)).is_err());
    }

    #[test]
    fn fixed_routes_and_size_limits_reject_bad_responses() {
        assert!(external_bridge_request(HTTP_PORT, "GET", "https://untrusted.example", &[], Duration::from_secs(1)).is_err());
        assert!(external_bridge_request(HTTP_PORT, "POST", AGENT_STATUS_PATH, &vec![b'x'; 128*1024+1], Duration::from_secs(1)).is_err());
        for reply in [
            b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\nnot a bridge".to_vec(),
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2097153\r\n\r\n".to_vec(),
            b"HTTP/1.1 302 Found\r\nContent-Type: application/json\r\nLocation: https://untrusted.example\r\n\r\n".to_vec(),
            [b"HTTP/1.1 200 OK\r\nX-Huge: ".as_slice(), &vec![b'x'; 17000]].concat(),
        ] {
            let fixture = raw_fixture(reply, Duration::ZERO);
            assert!(external_bridge_request(HTTP_PORT, "GET", HEALTH_PATH, &[], Duration::from_secs(1)).is_err());
            fixture.join().unwrap();
        }
    }
}
'''


def main() -> int:
    repo = Path(__file__).resolve().parents[1]
    temporary = Path(tempfile.mkdtemp(prefix="aivatar-external-bridge-smoke-"))
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    bridge_source = (repo / "src-tauri/src/local_bridge.rs").read_text()
    assert bridge_source.count("const HTTP_PORT: u16 = 38988;") == 1
    bridge_source = bridge_source.replace("const HTTP_PORT: u16 = 38988;", f"const HTTP_PORT: u16 = {port};")
    js_source = (repo / "scripts/codex-status-bridge.mjs").read_text()
    writer = js_source[js_source.index("const sendJson = "):js_source.index("const roomTimestampMs = ")]
    node_fixture = (
        "const http=require('node:http');\n" + writer + r'''
const port=__FIXTURE_PORT__;
http.createServer(async(req,res)=>{
  let raw=''; for await(const part of req) raw+=part;
  const body=raw?JSON.parse(raw):{};
  console.log(JSON.stringify({path:req.url,body}));
  if(req.url==='/health') return sendJson(res,200,{ok:true,http:`http://127.0.0.1:${port}/agent-status`,websocket:'ws://127.0.0.1:38987/agent-status'});
  if(body.sessionId==='malformed') return sendJson(res,202,[]);
  if(body.sessionId==='headers-only') {
    res.writeHead(200,{'content-type':'application/json','content-length':100});res.flushHeaders();
    setTimeout(()=>res.end('private synthetic snapshot'),1200); return;
  }
  sendJson(res,body.sessionId==='failure'?500:body.sessionId==='redirect'?302:body.sessionId==='native-200'?200:202,{type:'aivatar.status.snapshot',sessions:[],...(body.sessionId==='ignored'?{ignored:true}:{})});
}).listen(port,'127.0.0.1',()=>console.log('ready'));
'''
    )
    bridge_source += f"\nconst NODE_FIXTURE: &str = {json.dumps(node_fixture)};\n" + TESTS
    (temporary / "local_bridge.rs").write_text(bridge_source)
    source_dir = temporary / "src"
    source_dir.mkdir()
    source = "#![allow(dead_code)]\n"
    for name in ["codex_discovery", "learning_job", "workbuddy_discovery", "local_bridge"]:
        path = temporary / "local_bridge.rs" if name == "local_bridge" else repo / "src-tauri/src" / f"{name}.rs"
        source += f"#[path = {json.dumps(str(path))}]\nmod {name};\n"
    (source_dir / "lib.rs").write_text(source)
    (temporary / "Cargo.toml").write_text(
        '[package]\nname="aivatar-external-bridge-smoke"\nversion="0.0.0"\nedition="2021"\n'
        '[dependencies]\nserde_json="1"\ntungstenite="0.24"\n'
        'chrono={version="0.4",default-features=false,features=["clock"]}\n'
        'rusqlite={version="0.32",features=["bundled"]}\n'
    )
    environment = os.environ.copy()
    environment["CARGO_TARGET_DIR"] = str(temporary / "target")
    print(f"External bridge synthetic fixture (retained): {temporary}", flush=True)
    result = subprocess.run(
        [shutil.which("cargo") or "cargo", "test", "--offline", "external_bridge_tests", "--", "--test-threads=1", "--nocapture"],
        cwd=temporary, env=environment, timeout=180, check=False,
    )
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
