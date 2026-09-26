"""Run the real release build guards with synthetic files and Git/GitHub replies.

Uses only the Python 3.11+ standard library. No application, real repository
command, network request, signing key or user save is accessed. Derived fixtures
are retained in the printed temporary directory for inspection.

Run: python scripts/security/updater-build-guard-smoke.py
     python scripts/security/updater-build-guard-smoke.py --workflow-dir PATH
"""
import argparse
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
from unittest.mock import patch


REPO = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--workflow-dir", type=Path, default=REPO / ".github/workflows")
options = parser.parse_args()
ROOT = Path(tempfile.mkdtemp(prefix="aivatar-build-guard-qa-"))
SHA = "a" * 40
PREVIOUS = "b" * 40
OTHER = "c" * 40
VERSION = "0.5.1"
TAG = f"v{VERSION}"
COUNT = 0


def inline_step(source, name):
    """Extract a named, literal run block; reject ambiguous workflow layouts."""
    lines = source.splitlines()
    matches = [index for index, line in enumerate(lines) if line == f"      - name: {name}"]
    assert len(matches) == 1, f"Expected exactly one workflow step: {name}"
    start = matches[0] + 1
    end = next((index for index in range(start, len(lines))
                if lines[index].strip() and not lines[index].startswith("        ")), len(lines))
    body = lines[start:end]
    runs = [index for index, line in enumerate(body) if line == "        run: |"]
    assert len(runs) == 1, f"Expected a literal Python run block: {name}"
    script = body[runs[0] + 1:]
    assert script and all(not line.strip() or line.startswith("          ") for line in script)
    return "\n".join(line[10:] if line.strip() else "" for line in script) + "\n"


def synthetic_files():
    package = {"name": "aivatar", "version": VERSION,
               "devDependencies": {"@tauri-apps/cli": "2.11.5"}}
    lock = {"version": VERSION, "packages": {"": {"version": VERSION}}}
    tauri = {"version": VERSION, "bundle": {
        "createUpdaterArtifacts": True,
        "resources": ["../plugins/aivatar-session-bridge/", "../scripts/*.mjs",
                      "../scripts/*.py", "../scripts/*.swift"]},
        "plugins": {"updater": {"pubkey": "synthetic-public-key", "requireSignedVersion": True}}}
    return {"package.json": json.dumps(package), "package-lock.json": json.dumps(lock),
            "src-tauri/tauri.conf.json": json.dumps(tauri),
            "src-tauri/Cargo.toml": f'[package]\nname = "aivatar"\nversion = "{VERSION}"\n',
            "src-tauri/Cargo.lock": f'[[package]]\nname = "aivatar"\nversion = "{VERSION}"\n'}


def no_external_io(*args, **kwargs):
    raise AssertionError("Unexpected external process or network access")


for platform in ("macos", "windows"):
    source = (options.workflow_dir / f"release-{platform}.yml").read_text(encoding="utf-8")
    guards = [inline_step(source, name) for name in (
        "Require an immutable source commit", "Check source, versions, release mode and tag")]

    def run_case(label, *, replacement=False, env_changes=None, files_change=None,
                 main_sha=SHA, checkout_sha=SHA, tag_sha=None, missing_tag=False,
                 annotated=False, release_change=None, missing_release=False,
                 expected=None, release_calls=0):
        global COUNT
        directory = Path(tempfile.mkdtemp(prefix=f"{platform}-", dir=ROOT))
        checkout = directory / "source"
        runner = directory / "runner"
        runner.mkdir()
        files = synthetic_files()
        if files_change:
            files_change(files)
        for name, value in files.items():
            path = checkout / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(value, encoding="utf-8")
        environment = {"SOURCE_SHA": SHA, "RELEASE_TAG": TAG,
                       "REPLACE_RELEASE": "true" if replacement else "false",
                       "PREVIOUS_SOURCE": PREVIOUS if replacement else "",
                       "GITHUB_REPOSITORY": "ruiwuniu/Aivatar-Demo",
                       "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": SHA,
                       "WORKFLOW_COMMIT": SHA,
                       "WORKFLOW_REFERENCE": f"ruiwuniu/Aivatar-Demo/.github/workflows/release-{platform}.yml@refs/heads/main",
                       "GITHUB_ENV": str(directory / "github-env"), "RUNNER_TEMP": str(runner),
                       "GH_TOKEN": "synthetic-contents-read"}
        environment.update(env_changes or {})
        target = tag_sha if tag_sha is not None else PREVIOUS if replacement else SHA
        reference = {"type": "tag", "sha": OTHER} if annotated else {"type": "commit", "sha": target}
        api_payloads = {"git/ref/heads/main": {"object": {"sha": main_sha}},
                        f"git/matching-refs/tags/{TAG}": [] if missing_tag else [
                            {"ref": f"refs/tags/{TAG}", "object": reference}],
                        f"git/tags/{OTHER}": {"object": {"type": "commit", "sha": target}}}
        release = {"tagName": TAG, "isDraft": False, "isPrerelease": False,
                   "targetCommitish": PREVIOUS}
        release.update(release_change or {})
        calls = []

        def check_output(args, **kwargs):
            assert kwargs == {"text": True}
            calls.append(args)
            if args == ["git", "rev-parse", "HEAD"]:
                return checkout_sha + "\n"
            if args[:3] == ["gh", "release", "view"]:
                assert replacement, "Normal read-only builds must never query a release"
                assert args == ["gh", "release", "view", TAG, "--repo", "ruiwuniu/Aivatar-Demo",
                                "--json", "tagName,isDraft,isPrerelease,targetCommitish"]
                if missing_release:
                    raise subprocess.CalledProcessError(1, args, stderr="release not found")
                return json.dumps(release)
            assert args[:2] == ["gh", "api"] and len(args) == 3, f"Unexpected command: {args}"
            prefix = "repos/ruiwuniu/Aivatar-Demo/"
            assert args[2].startswith(prefix)
            endpoint = args[2][len(prefix):]
            assert endpoint in api_payloads, f"Unexpected API access (including releases): {endpoint}"
            return json.dumps(api_payloads[endpoint])

        def run(args, **kwargs):
            assert kwargs == {"check": True}
            assert args == ["git", "diff", "--exit-code", "HEAD", "--", "package.json",
                            "package-lock.json", "src-tauri/tauri.conf.json",
                            "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]
            return subprocess.CompletedProcess(args, 0)

        failure = None
        with patch.dict(os.environ, environment, clear=True), patch.object(Path, "cwd", return_value=checkout), \
                patch("subprocess.check_output", check_output), patch("subprocess.run", run), \
                patch("subprocess.Popen", no_external_io), patch.object(socket, "socket", no_external_io), \
                patch.object(socket, "create_connection", no_external_io), redirect_stdout(io.StringIO()):
            try:
                for index, script in enumerate(guards):
                    script_path = runner / f"inline-{index}.py"
                    script_path.write_text(script, encoding="utf-8")
                    exec(compile(script, str(script_path), "exec"),
                         {"__name__": "__main__", "__file__": str(script_path)})
            except (SystemExit, subprocess.CalledProcessError) as error:
                failure = error
        if expected is None:
            assert failure is None, f"{label}: unexpected rejection: {failure}"
            assert (directory / "github-env").read_text() == f"RELEASE_VERSION={VERSION}\n"
            assert (runner / "aivatar-release-guard.py").read_text() == guards[1]
        elif isinstance(expected, str):
            assert isinstance(failure, SystemExit) and expected in str(failure), f"{label}: wrong rejection: {failure}"
        else:
            assert isinstance(failure, expected), f"{label}: expected {expected}, got {failure}"
        queried_releases = [args for args in calls if args[:3] == ["gh", "release", "view"]]
        assert len(queried_releases) == release_calls, f"{label}: unexpected release query count"
        COUNT += 1
        print(f"PASS {platform} {label}")

    run_case("normal contents-read path performs no release query")
    run_case("normal annotated tag resolves to the approved source", annotated=True)
    run_case("normal rejects workflow/source mismatch", env_changes={"WORKFLOW_COMMIT": OTHER},
             expected="exact current main commit")
    run_case("normal rejects moved main", main_sha=OTHER, expected="head of protected main")
    run_case("normal rejects mismatched checkout", checkout_sha=OTHER, expected="does not match requested source")
    run_case("normal rejects missing tag", missing_tag=True, expected="tag must already exist")
    run_case("normal rejects moved tag", tag_sha=OTHER, expected="does not point to the approved")
    run_case("normal rejects previous_source", env_changes={"PREVIOUS_SOURCE": PREVIOUS},
             expected="only accepted for explicit replacement")
    for filename in synthetic_files():
        run_case(f"normal rejects version mismatch in {filename}",
                 files_change=lambda files, name=filename: files.update({name: files[name].replace(VERSION, "0.5.2")}),
                 expected="versions must match")
    run_case("normal retains the resource allowlist", files_change=lambda files: files.update({
        "src-tauri/tauri.conf.json": files["src-tauri/tauri.conf.json"].replace("../scripts/*.mjs", "../scripts/**")}),
        expected="approved plugin directory and top-level script globs")
    run_case("replacement requires and accepts the published release", replacement=True, release_calls=1)
    for field, value in (("isDraft", True), ("isPrerelease", True), ("tagName", "v0.5.2")):
        run_case(f"replacement rejects invalid {field}", replacement=True,
                 release_change={field: value}, release_calls=1, expected="published stable release")
    run_case("replacement rejects the wrong release target", replacement=True,
             release_change={"targetCommitish": SHA}, release_calls=1, expected="Release target must match")
    run_case("replacement does not swallow release-query failure", replacement=True,
             missing_release=True, release_calls=1, expected=subprocess.CalledProcessError)
    run_case("replacement rejects the current source as previous", replacement=True,
             env_changes={"PREVIOUS_SOURCE": SHA}, expected="different previous full source SHA")
    run_case("replacement rejects a moved previous tag", replacement=True, tag_sha=OTHER,
             release_calls=1, expected="does not point to the approved")

print(f"PASS {COUNT} release build guard checks; derived fixtures retained at {ROOT}")
