#!/usr/bin/env python3
"""Run the native Codex/bridge regression tests without building the Tauri GUI.

The temporary crate imports the real production modules and their unit tests.
It does not start discovery, the application, or bridge listeners. Cargo runs
offline, and generated fixtures/build artifacts remain in the printed directory.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def main() -> int:
    cargo = shutil.which("cargo")
    if cargo is None:
        print("cargo was not found on PATH", file=sys.stderr)
        return 1

    repo = Path(__file__).resolve().parents[1]
    modules = {
        "codex_discovery": repo / "src-tauri" / "src" / "codex_discovery.rs",
        "local_bridge": repo / "src-tauri" / "src" / "local_bridge.rs",
    }
    for path in modules.values():
        if not path.is_file():
            print(f"Native source module is missing: {path}", file=sys.stderr)
            return 1

    temporary = Path(tempfile.mkdtemp(prefix="aivatar-codex-native-smoke-"))
    source_dir = temporary / "src"
    source_dir.mkdir()
    (temporary / "Cargo.toml").write_text(
        '[package]\n'
        'name = "aivatar-codex-native-smoke"\n'
        'version = "0.0.0"\n'
        'edition = "2021"\n'
        '\n[dependencies]\n'
        'serde_json = "1"\n'
        'chrono = { version = "0.4", default-features = false, features = ["clock"] }\n'
        'tungstenite = "0.24"\n',
        encoding="utf-8",
    )
    source = "#![allow(dead_code)]\n"
    for name, path in modules.items():
        # JSON escaping also produces valid Rust strings for these file paths.
        quoted_path = json.dumps(str(path), ensure_ascii=False)
        source += f"#[path = {quoted_path}]\nmod {name};\n"
    (source_dir / "lib.rs").write_text(source, encoding="utf-8")

    environment = os.environ.copy()
    environment["CARGO_TARGET_DIR"] = str(temporary / "target")
    environment["AIVATAR_LEARNING_PROVIDER"] = "none"
    environment["AIVATAR_LEARNING_ENABLED"] = "0"
    command = [
        cargo,
        "test",
        "--offline",
        "--",
        "--nocapture",
        "--test-threads=1",
    ]
    print(f"Native smoke test crate (retained): {temporary}", flush=True)
    print("Running regression tests against the current Rust source modules.", flush=True)
    result = subprocess.run(command, cwd=temporary, env=environment, check=False)
    if result.returncode:
        print(
            f"Native smoke tests failed; inspect the retained crate at {temporary}. "
            "Offline builds require the dependencies to be present in the Cargo cache.",
            file=sys.stderr,
        )
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
