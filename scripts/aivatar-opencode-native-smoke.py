#!/usr/bin/env python3
"""Compile the production OpenCode install/version helpers in an isolated Rust harness."""
import json
import pathlib
import shutil
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parents[1]
source = (root / "src-tauri/src/lib.rs").read_text()
functions = []
for name, following in [
    ("opencode_api_major", "opencode_learning_command"),
    ("detect_opencode_api_major", "opencode_plugin_entrypoint"),
]:
    functions.append(source[source.index(f"fn {name}("):source.index(f"fn {following}(")])
functions.append(source[source.index("fn opencode_plugin_entrypoint("):source.index("fn claude_settings_path()")])
temporary = pathlib.Path(tempfile.mkdtemp(prefix="aivatar-opencode-native-smoke-"))
node = shutil.which("node")
assert node, "Node is required for generated plugin syntax checks"
extra = r'''
#[test]
fn production_installer_generates_valid_standalone_files() {
    let original = std::fs::read_to_string(SOURCE_PATH).unwrap();
    for major in [1, 2] {
        let output = opencode_plugin_entrypoint(&original, major);
        assert_eq!(output.matches("// AIVATAR_OPENCODE_API:").count(), 3);
        let path = std::path::Path::new(TEMP_PATH).join(format!("native-plugin-v{major}.mjs"));
        std::fs::write(&path, &output).unwrap();
        let check = std::process::Command::new(NODE_PATH).arg("--check").arg(path).output().unwrap();
        assert!(check.status.success(), "{}", String::from_utf8_lossy(&check.stderr));
    }
}
#[cfg(unix)]
#[test]
fn native_probe_reads_version_without_opening_user_configuration() {
    use std::os::unix::fs::PermissionsExt;
    let path = std::path::Path::new(TEMP_PATH).join("fake-opencode");
    std::fs::write(&path, "#!/bin/sh\nprintf 'opencode 2.0.26\\n'\n").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(detect_opencode_api_major(&path), Some(2));
    assert_eq!(detect_opencode_api_major(&std::path::Path::new(TEMP_PATH).join("absent")), None);
}
'''
constants = "\n".join(f"const {name}: &str = {json.dumps(str(value))};" for name, value in [
    ("SOURCE_PATH", root / "scripts/aivatar-opencode-plugin.mjs"),
    ("TEMP_PATH", temporary), ("NODE_PATH", node)])
(temporary / "test.rs").write_text("\n".join(functions) + "\n" + constants + extra)
subprocess.run(["rustc", "--edition=2021", "--test", str(temporary / "test.rs"), "-o", str(temporary / "test")], check=True)
subprocess.run([str(temporary / "test"), "--nocapture"], check=True)
print(json.dumps({"ok": True, "temporary": str(temporary)}))
