#!/usr/bin/env node
// Only temporary synthetic programs are executed; no provider or user data.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { learningCommandInvocation } from "./aivatar-learning-command.mjs";

const unchanged = ["", '{"value":"safe"}'];
for (const [command, platform] of [["/synthetic/tool", "darwin"], ["C:\\synthetic\\tool.exe", "win32"]]) {
  assert.deepEqual(learningCommandInvocation(command, unchanged, platform, {}), { command, args: unchanged, windowsVerbatimArguments: false });
}
for (const value of ["x\ny", "x\ry", "x\0y"]) {
  assert.throws(() => learningCommandInvocation("C:\\synthetic\\tool.cmd", [value], "win32", {}));
}
assert.equal(learningCommandInvocation("C:\\synthetic\\tool.cmd", [], "win32", { SystemRoot: "C:\\Windows" }).command, "C:\\Windows\\System32\\cmd.exe");
assert.throws(() => learningCommandInvocation("C:\\synthetic\\tool.cmd", ["x".repeat(8192)], "win32", {}));
console.log("PASS native invocation and rejected Windows control characters");

if (process.platform === "win32") {
  const directory = await mkdtemp(join(tmpdir(), "aivatar command argv-"));
  const fixture = join(directory, "capture.mjs");
  await writeFile(fixture, 'console.log(JSON.stringify(process.argv.slice(2)));\n');
  const expected = ["", "space value", "中文参数", 'a"b', "trailing\\", "two\\\\", '{"mcpServers":{},"message":"a & b | c"}', "()[]{}^%!;,*?`", "%AIVATAR_SENTINEL%", "!AIVATAR_SENTINEL!", "x & echo should-not-run > injected.txt", "x | echo should-not-run", "<stdin>"];
  const env = { SystemRoot: process.env.SystemRoot, PATH: "", HOME: directory, USERPROFILE: directory, AIVATAR_SENTINEL: "EXPANDED_UNEXPECTEDLY" };
  for (const [name, compound] of [["plain", false], ["space 中文 (test) & caret^", false], ["npm-global", true], ["node_modules/.bin", true]]) {
    const folder = join(directory, name);
    await mkdir(folder, { recursive: true });
    const command = join(folder, "provider.cmd");
    const line = `@"${process.execPath}" "${fixture}" %*\r\n`;
    await writeFile(command, compound
      ? `@ECHO off\r\nSETLOCAL\r\nSET "_prog=${process.execPath}"\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" "${fixture}" %*\r\n`
      : line);
    const invocation = learningCommandInvocation(command, expected, "win32", env);
    const result = spawnSync(invocation.command, invocation.args, { cwd: directory, env, shell: false, windowsHide: true, windowsVerbatimArguments: invocation.windowsVerbatimArguments, encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, `${name}: ${result.stderr} ${result.error?.code ?? ""}`);
    assert.deepEqual(JSON.parse(result.stdout.trim()), expected, `${name}: arguments must round-trip exactly`);
    await assert.rejects(access(join(directory, "injected.txt")), { code: "ENOENT" });
    console.log(`PASS Windows argv fidelity: ${name}`);
  }
  console.log(`Retained synthetic fixtures: ${directory}`);
} else {
  console.log("Windows subprocess round-trips run on the Windows CI runner.");
}
