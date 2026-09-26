"""Exercise the trusted inline release-job code without secrets or network.

Run: python -m pip install PyYAML==6.0.3
     python scripts/security/updater-workflow-smoke.py
Requires OpenSSL 3. Synthetic private key bytes remain in memory only.
"""
import argparse
import ast
import base64
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
from unittest.mock import patch
import zipfile

import yaml

REPO = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--openssl", help="Path to an OpenSSL 3 executable")
options = parser.parse_args()
candidates = [options.openssl] if options.openssl else [shutil.which("openssl"), "/opt/homebrew/opt/openssl@3/bin/openssl", "/usr/local/opt/openssl@3/bin/openssl"]
OPENSSL = None
for candidate in candidates:
    if candidate and Path(candidate).is_file():
        probe = subprocess.run([candidate, "version"], capture_output=True, text=True)
        if probe.returncode == 0 and probe.stdout.startswith("OpenSSL 3."):
            OPENSSL = candidate
            break
assert OPENSSL, "OpenSSL 3 is required; supply --openssl /path/to/openssl"
ROOT = Path(tempfile.mkdtemp(prefix="aivatar-workflow-security-"))
REAL_RUN = subprocess.run
PRIVATE_KEY = subprocess.check_output([OPENSSL, "genpkey", "-algorithm", "ed25519"])
PUBLIC_DER = subprocess.check_output([OPENSSL, "pkey", "-pubout", "-outform", "DER"], input=PRIVATE_KEY)
KEY_ID = bytes.fromhex("0123456789abcdef")
PUBLIC_KEY = base64.b64encode(b"untrusted comment: synthetic workflow QA\n" + base64.b64encode(b"Ed" + KEY_ID + PUBLIC_DER[-32:]) + b"\n").decode()
VERSION = "0.5.1"
SHA = "a" * 40
COUNT = 0


def check(name, work, failure=None):
    global COUNT
    try:
        work()
    except SystemExit as error:
        if failure is None or failure not in str(error):
            raise AssertionError(f"{name}: unexpected rejection: {error}") from error
    else:
        if failure is not None:
            raise AssertionError(f"{name}: unsafe input was accepted")
    COUNT += 1
    print(f"PASS {name}")


def fresh(label):
    return Path(tempfile.mkdtemp(prefix=f"{label}-", dir=ROOT))


def openssl_run(args, **kwargs):
    if args[0] == "/usr/bin/openssl":
        args = [OPENSSL, *args[1:]]
    return REAL_RUN(args, **kwargs)


def execute(code, directory, environment=None, api=None, popen=None, runner=None):
    script = directory / "inline.py"
    script.write_text(code)
    env = {"RUNNER_TEMP": str(directory), **(environment or {})}
    with patch.dict(os.environ, env, clear=True), patch("subprocess.run", runner or openssl_run):
        if api is None:
            exec(compile(code, str(script), "exec"), {"__file__": str(script), "__name__": "__main__"})
        else:
            with patch("subprocess.check_output", api):
                if popen is None:
                    exec(compile(code, str(script), "exec"), {"__file__": str(script), "__name__": "__main__"})
                else:
                    with patch("subprocess.Popen", popen):
                        exec(compile(code, str(script), "exec"), {"__file__": str(script), "__name__": "__main__"})


def signed(payload, comment, directory):
    # Only non-sensitive messages and public signatures touch disk. The newly
    # generated private key is provided over stdin to the trusted OpenSSL tool.
    message = directory / "synthetic-message"
    message.write_bytes(hashlib.blake2b(payload).digest())
    signature = subprocess.check_output([OPENSSL, "pkeyutl", "-sign", "-rawin", "-inkey", "/dev/stdin", "-in", str(message)], input=PRIVATE_KEY)
    message.write_bytes(signature + comment.encode())
    global_signature = subprocess.check_output([OPENSSL, "pkeyutl", "-sign", "-rawin", "-inkey", "/dev/stdin", "-in", str(message)], input=PRIVATE_KEY)
    box = b"untrusted comment: synthetic workflow QA\n" + base64.b64encode(b"ED" + KEY_ID + signature) + b"\ntrusted comment: " + comment.encode() + b"\n" + base64.b64encode(global_signature) + b"\n"
    return base64.b64encode(box).decode()


def context(platform):
    return {"repo": "ruiwuniu/Aivatar-Demo", "sourceCommit": SHA, "version": VERSION,
            "tag": f"v{VERSION}", "platform": platform, "runId": "123", "runAttempt": "1", "publicKey": PUBLIC_KEY,
            "replacement": None}


def names(platform):
    return [f"Aivatar_{VERSION}_universal.dmg", "Aivatar.app.tar.gz"] if platform == "macos" else [f"Aivatar_{VERSION}_x64-setup.exe", f"Aivatar_{VERSION}_x64_en-US.msi"]


def metadata(name, payload):
    return {"name": name, "size": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}


for platform in ("macos", "windows"):
    workflow = yaml.safe_load((REPO / f".github/workflows/release-{platform}.yml").read_text())
    build = workflow["jobs"][f"build-{platform}"]
    signer = workflow["jobs"]["sign-and-upload"]
    assert build["permissions"] == {"contents": "read"}
    assert "secrets." not in json.dumps(build), "Build must never reference a secret"
    assert "updater-signing" == signer["environment"]
    assert signer["needs"] == f"build-{platform}"
    assert signer["permissions"] == {"actions": "read", "contents": "write"}
    assert signer["defaults"]["run"]["shell"] == "python -I {0}"
    checkouts = [step for step in build["steps"] if step.get("uses", "").startswith("actions/checkout@")]
    assert len(checkouts) == 1 and checkouts[0]["with"]["persist-credentials"] is False
    assert all(re.fullmatch(r"[\w/-]+@[0-9a-f]{40}", step["uses"]) for job in workflow["jobs"].values() for step in job["steps"] if "uses" in step)
    artifact_steps = [step for step in signer["steps"] if "uses" in step]
    assert artifact_steps == [signer["steps"][-1]], "Only the final replacement artifact upload may use an action"
    assert artifact_steps[0]["uses"] == "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02"
    assert artifact_steps[0]["if"] == "${{ inputs.replace_release }}"
    assert artifact_steps[0]["with"]["name"] == f"signed-{platform}-${{{{ inputs.ref }}}}-${{{{ github.run_attempt }}}}"
    assert artifact_steps[0]["with"]["path"] == "${{ runner.temp }}/signed-release/*"
    inputs = (workflow.get("on") or workflow[True])["workflow_dispatch"]["inputs"]
    assert inputs["replace_release"]["type"] == "boolean" and inputs["replace_release"]["default"] is False
    assert inputs["previous_source"]["default"] == ""
    assert all(job["env"]["REPLACE_RELEASE"] == "${{ inputs.replace_release && 'true' || 'false' }}" for job in (build, signer))
    secret_steps = [step for step in signer["steps"] if "secrets." in json.dumps(step)]
    assert len(secret_steps) == 1
    assert secret_steps[0]["env"] == {"TAURI_SIGNING_PRIVATE_KEY": "${{ secrets.AIVATAR_RELEASE_SIGNING_PRIVATE_KEY }}"}
    assert "--app-version" in secret_steps[0]["run"] and "GH_TOKEN" not in secret_steps[0].get("env", {})
    assert "repo" not in secret_steps[0].get("working-directory", "")
    for step in signer["steps"]:
        if "run" not in step:
            continue
        tree = ast.parse(step["run"])
        for call in (node for node in ast.walk(tree) if isinstance(node, ast.Call)):
            assert not (isinstance(call.func, ast.Name) and call.func.id in {"exec", "eval", "compile", "__import__"}), "Signer must not execute downloaded code"
            assert not any(kw.arg == "shell" and isinstance(kw.value, ast.Constant) and kw.value.value for kw in call.keywords)
        assert "extractall(" not in step["run"]
    COUNT += 1
    print(f"PASS {platform} permissions, secret scope, pinned actions and non-executable artifact handling")
    steps = {step["name"]: step["run"] for step in signer["steps"] if "run" in step}
    guard = steps["Revalidate the protected workflow, main commit, tag and release mode"]
    verifier = steps["Verify signatures and signed versions without loading repository code"]
    downloader = steps["Download only this run's immutable artifact and verify its digest"]
    route = steps["Recheck the release and route only the signed asset allowlist"]
    env = {"SOURCE_SHA": SHA, "RELEASE_TAG": f"v{VERSION}", "SIGNING_READY": "environment-only-v1",
           "REPLACE_RELEASE": "false", "PREVIOUS_SOURCE": "",
           "GITHUB_REPOSITORY": "ruiwuniu/Aivatar-Demo", "GITHUB_REF": "refs/heads/main",
           "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_SHA": SHA, "WORKFLOW_COMMIT": SHA,
           "WORKFLOW_REFERENCE": f"ruiwuniu/Aivatar-Demo/.github/workflows/release-{platform}.yml@refs/heads/main",
           "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1"}
    config = {"version": VERSION, "bundle": {"createUpdaterArtifacts": True}, "plugins": {"updater": {
        "pubkey": PUBLIC_KEY, "requireSignedVersion": True,
        "endpoints": ["https://github.com/ruiwuniu/Aivatar-Demo/releases/latest/download/latest.json"]}}}
    package = {"version": VERSION, "devDependencies": {"@tauri-apps/cli": "2.11.5"}}
    draft_release = {"draft": True, "prerelease": False, "tag_name": f"v{VERSION}", "target_commitish": SHA}
    fixtures = {
        "git/ref/heads/main": {"object": {"sha": SHA}},
        f"git/ref/tags/v{VERSION}": {"object": {"type": "commit", "sha": SHA}},
        # Drafts are visible through the authenticated list, not the tag endpoint.
        "releases?per_page=100": [draft_release],
        "actions/runs/123": {"event": "workflow_dispatch", "head_branch": "main", "head_sha": SHA, "path": f".github/workflows/release-{platform}.yml", "run_attempt": 1},
    }
    for path, value in (("src-tauri/tauri.conf.json", config), ("package.json", package)):
        payload = json.dumps(value).encode()
        fixtures[f"contents/{path}?ref={SHA}"] = {"encoding": "base64", "size": len(payload), "content": base64.b64encode(payload).decode()}

    def guard_case(env_changes=None, fixture_changes=None, directory=None):
        payloads = copy.deepcopy(fixtures)
        payloads.update(fixture_changes or {})
        current_env = {**env, **(env_changes or {})}
        release_endpoint = f"releases/tags/v{VERSION}" if current_env["REPLACE_RELEASE"] == "true" else "releases?per_page=100"
        def api(args, **_):
            assert args[:2] == ["gh", "api"]
            prefix = "repos/ruiwuniu/Aivatar-Demo/"
            assert args[2].startswith(prefix)
            endpoint = args[2][len(prefix):]
            if endpoint.startswith("releases"):
                assert endpoint == release_endpoint, "Drafts require list lookup; replacements retain published tag lookup"
            return json.dumps(payloads[endpoint])
        directory = directory or fresh("guard")
        execute(guard, directory, current_env, api)
        return directory

    check(f"{platform} valid protected source/tag/draft", guard_case)
    check(f"{platform} fork dispatch rejected", lambda: guard_case({"GITHUB_REPOSITORY": "fork/Aivatar-Demo"}), "Only this repository")
    check(f"{platform} unconfigured environment rejected", lambda: guard_case({"SIGNING_READY": ""}), "Configure and review")
    check(f"{platform} workflow/source mismatch rejected", lambda: guard_case({"WORKFLOW_COMMIT": "b" * 40}), "Workflow, source")
    check(f"{platform} moved main rejected", lambda: guard_case(fixture_changes={"git/ref/heads/main": {"object": {"sha": "b" * 40}}}), "Main advanced")
    check(f"{platform} moved tag rejected", lambda: guard_case(fixture_changes={f"git/ref/tags/v{VERSION}": {"object": {"type": "commit", "sha": "b" * 40}}}), "release tag moved")
    check(f"{platform} draft list ignores unrelated release tags", lambda: guard_case(fixture_changes={
        "releases?per_page=100": [{**draft_release, "tag_name": "v0.5.0", "draft": False}, draft_release]}))
    check(f"{platform} missing draft rejected", lambda: guard_case(fixture_changes={
        "releases?per_page=100": [{**draft_release, "tag_name": "v0.5.0"}]}), "exactly one existing stable draft")
    check(f"{platform} ambiguous draft rejected", lambda: guard_case(fixture_changes={
        "releases?per_page=100": [draft_release, {**draft_release}]}), "exactly one existing stable draft")
    check(f"{platform} wrong draft target rejected", lambda: guard_case(fixture_changes={
        "releases?per_page=100": [{**draft_release, "target_commitish": "b" * 40}]}), "existing stable draft")
    check(f"{platform} prerelease draft rejected", lambda: guard_case(fixture_changes={
        "releases?per_page=100": [{**draft_release, "prerelease": True}]}), "existing stable draft")
    check(f"{platform} published release rejected", lambda: guard_case(fixture_changes={
        "releases?per_page=100": [{**draft_release, "draft": False}]}), "existing stable draft")

    previous = "b" * 40
    replacement_env = {"REPLACE_RELEASE": "true", "PREVIOUS_SOURCE": previous}
    replacement_release = {"draft": False, "prerelease": False, "tag_name": f"v{VERSION}", "target_commitish": previous,
                           "id": 42, "published_at": "2026-09-20T00:00:00Z", "updated_at": "2026-09-20T00:00:01Z"}
    replacement_fixtures = {f"git/ref/tags/v{VERSION}": {"object": {"type": "commit", "sha": previous}},
                            f"releases/tags/v{VERSION}": replacement_release}

    def replacement_case(env_changes=None, fixture_changes=None, directory=None):
        directory = guard_case({**replacement_env, **(env_changes or {})}, {**replacement_fixtures, **(fixture_changes or {})}, directory)
        evidence = json.loads((directory / "aivatar-signing/release-context.json").read_text())["replacement"]
        assert evidence == {"previousSourceCommit": previous, "releaseId": 42,
                            "publishedAt": replacement_release["published_at"], "updatedAt": replacement_release["updated_at"]}
        return directory

    check(f"{platform} explicit replacement accepts the unchanged published release", replacement_case)
    check(f"{platform} replacement rejects wrong previous source", lambda: replacement_case({"PREVIOUS_SOURCE": "c" * 40}), "release tag moved")
    check(f"{platform} replacement rejects current source as previous", lambda: replacement_case({"PREVIOUS_SOURCE": SHA}), "different previous")
    check(f"{platform} replacement rejects non-boolean mode", lambda: replacement_case({"REPLACE_RELEASE": "True"}), "explicit workflow boolean")
    check(f"{platform} normal mode rejects previous source", lambda: guard_case({"PREVIOUS_SOURCE": previous}), "only accepted for explicit")
    check(f"{platform} replacement rejects moved old tag", lambda: replacement_case(fixture_changes={f"git/ref/tags/v{VERSION}": {"object": {"type": "commit", "sha": "c" * 40}}}), "release tag moved")
    check(f"{platform} replacement rejects draft release", lambda: replacement_case(fixture_changes={f"releases/tags/v{VERSION}": {**replacement_release, "draft": True}}), "replacement requires a published stable release")
    check(f"{platform} replacement rejects release target drift", lambda: replacement_case(fixture_changes={f"releases/tags/v{VERSION}": {**replacement_release, "target_commitish": SHA}}), "replacement requires a published stable release")

    def changed_release_case():
        directory = replacement_case()
        guard_case(replacement_env, {**replacement_fixtures, f"releases/tags/v{VERSION}": {**replacement_release, "updated_at": "2026-09-20T00:00:02Z"}}, directory)

    check(f"{platform} final replacement guard rejects published release metadata drift", changed_release_case, "Release context changed")

    def route_case(replacement):
        directory = fresh("route")
        root = directory / "aivatar-signing"
        assets = root / "assets"
        assets.mkdir(parents=True)
        current = context(platform)
        if replacement:
            current["replacement"] = {"previousSourceCommit": previous, "releaseId": 42}
        (root / "release-context.json").write_text(json.dumps(current))
        expected = names(platform) + [name + ".sig" for name in names(platform) if not name.endswith(".dmg")]
        expected += [f"updater-{platform}.json", f"{platform}-release-checksums.json"]
        for name in expected + ["unsigned-build.json"]:
            (assets / name).write_text("synthetic output " + name)
        calls = []
        def run(args, **kwargs):
            assert kwargs == {"check": True}
            calls.append(args)
        execute(route, directory, runner=run)
        assert calls[0][1:] == ["-I", str(root / "release-guard.py")], "Must rerun trusted release guard before routing"
        if replacement:
            assert len(calls) == 1, "Replacement must never call gh release upload"
            staged = directory / "signed-release"
            assert sorted(item.name for item in staged.iterdir()) == sorted(expected)
            assert all((staged / name).read_bytes() == (assets / name).read_bytes() for name in expected)
        else:
            assert len(calls) == 2 and calls[1][:4] == ["gh", "release", "upload", f"v{VERSION}"]
            assert set(calls[1][4:-2]) == {str(assets / name) for name in expected}
            assert calls[1][-2:] == ["--repo", "ruiwuniu/Aivatar-Demo"]
            assert not (directory / "signed-release").exists()

    check(f"{platform} replacement exports exact assets without public upload", lambda: route_case(True))
    check(f"{platform} normal mode retains exact draft upload", lambda: route_case(False))

    def verifier_case(version_fields, forge=False):
        directory = fresh("verifier")
        root = directory / "aivatar-signing"
        assets = root / "assets"
        assets.mkdir(parents=True)
        (root / "release-context.json").write_text(json.dumps(context(platform)))
        (root / "artifact-provenance.json").write_text(json.dumps({"artifactId": 7, "artifactDigest": "sha256:" + "c" * 64, "workflowRunId": "123", "runAttempt": "1", "sourceCommit": SHA}))
        records = []
        for name in names(platform):
            payload = f"synthetic {platform} {name}".encode()
            (assets / name).write_bytes(payload)
            records.append(metadata(name, payload))
            if not name.endswith(".dmg"):
                comment = "timestamp:1\tfile:" + name + version_fields
                signature = signed(payload, comment, directory)
                if forge:
                    signature = base64.b64encode(base64.b64decode(signature).replace(b"version:0.5.1", b"version:0.5.2")).decode()
                (assets / (name + ".sig")).write_text(signature)
        (assets / "unsigned-build.json").write_text(json.dumps({"assets": records, "verification": {"applicationLaunched": False}}))
        execute(verifier, directory)
        report = json.loads((assets / f"updater-{platform}.json").read_text())
        assert report["verification"]["updaterSignedVersionMatches"] is True

    check(f"{platform} actual inline signature verifier accepts bound version", lambda: verifier_case(f"\tversion:{VERSION}"))
    check(f"{platform} missing signed version rejected", lambda: verifier_case(""), "exactly match")
    check(f"{platform} wrong signed version rejected", lambda: verifier_case("\tversion:0.5.2"), "exactly match")
    check(f"{platform} duplicate signed version rejected", lambda: verifier_case(f"\tversion:{VERSION}\tversion:{VERSION}"), "exactly match")
    check(f"{platform} forged version rejected by cryptographic check", lambda: verifier_case(f"\tversion:{VERSION}", True), "signature verification failed")

    def download_case(extra=False, symlink=False, large=False, wrong_run=False):
        directory = fresh("download")
        root = directory / "aivatar-signing"
        root.mkdir()
        current = context(platform)
        (root / "release-context.json").write_text(json.dumps(current))
        records = []
        archive_bytes = io.BytesIO()
        with zipfile.ZipFile(archive_bytes, "w") as archive:
            for index, name in enumerate(names(platform)):
                payload = f"synthetic {name}".encode()
                entry = zipfile.ZipInfo(name)
                entry.external_attr = ((stat.S_IFLNK if symlink and index == 0 else stat.S_IFREG) | 0o644) << 16
                archive.writestr(entry, payload)
                records.append(metadata(name, payload))
            archive.writestr("unsigned-build.json", json.dumps({**current, "assets": records}))
            if extra:
                archive.writestr("../release-guard.py", "raise RuntimeError('must never execute')")
        payload = archive_bytes.getvalue()
        artifact = {"name": f"unsigned-{platform}-{SHA}-1", "id": 7, "expired": False,
                    "workflow_run": {"id": 999 if wrong_run else 123, "head_sha": SHA},
                    "digest": "sha256:" + hashlib.sha256(payload).hexdigest(), "size_in_bytes": 9_000_000_000 if large else len(payload)}
        def api(*_, **__):
            return json.dumps({"artifacts": [artifact]})
        class Download:
            def __init__(self, args, **_):
                assert args == ["gh", "api", "repos/ruiwuniu/Aivatar-Demo/actions/artifacts/7/zip"]
                self.stdout = io.BytesIO(payload)
            def wait(self): return 0
            def poll(self): return 0
            def kill(self): raise AssertionError("Unexpected download termination")
        execute(downloader, directory, api=api, popen=Download)
        assert json.loads((root / "artifact-provenance.json").read_text())["artifactId"] == 7

    check(f"{platform} exact same-run artifact download", download_case)
    check(f"{platform} archive path injection rejected", lambda: download_case(extra=True), "exact flat asset allowlist")
    check(f"{platform} archive symlink rejected", lambda: download_case(symlink=True), "Invalid artifact type")
    check(f"{platform} oversized archive rejected before download", lambda: download_case(large=True), "download limit")
    check(f"{platform} artifact from other run rejected", lambda: download_case(wrong_run=True), "not from the approved")

print(f"{COUNT} updater workflow security checks passed; synthetic artifacts retained at {ROOT}")
