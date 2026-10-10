// A learning job owns one worker result. The worker runs in dry-run mode so
// only the caller can publish it, including when the worker fails or times out.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, win32 } from "node:path";
import { pathToFileURL } from "node:url";

const providers = new Set(["codex", "claude-code", "opencode", "codebuddy"]);
const reasons = new Set(["unavailable", "authentication", "timeout", "invalid-output", "empty-candidates", "incompatible-client", "invalid-schema", "provider-error"]);
const text = (value, limit) => typeof value === "string"
  ? Array.from(value.replace(/[\u0000-\u001f\u007f]/gu, " ")).slice(0, limit).join("") : "";
export const learningJobId = (options) => text(options.learningId, 128)
  || createHash("sha256").update(JSON.stringify([options.agent, options.sessionId, options.status, options.summary, options.digest])).digest("hex").slice(0, 32);

export const failedLearning = (options, reason = "provider-error") => ({
  id: learningJobId(options),
  source: "heuristic",
  summary: "Aivatar noticed the end of a task.",
  idleBubbleCandidates: ["又学会了一点点", "慢慢来就很好"],
  socialBubbleCandidates: [],
  traitChanges: {},
  xp: 1,
  confidence: 0.2,
  privacyRisk: "low",
  ...(options.provider !== "none" ? {
    diagnostic: { provider: providers.has(options.provider) ? options.provider : options.agent === "workbuddy" ? "codebuddy" : options.agent, status: "fallback", reason: reasons.has(reason) ? reason : "provider-error", timestamp: new Date().toISOString() },
  } : {}),
});

export const learningStatus = (options, learning) => ({
  agent: options.agent,
  sessionId: options.sessionId,
  status: options.status === "error" ? "error" : "complete",
  phase: "session-learning",
  summary: learning.summary,
  message: learning.summary,
  progress: options.status === "error" ? 50 : 100,
  severity: options.status === "error" ? "error" : "info",
  timestamp: new Date().toISOString(),
  learning,
});

const workerResult = (raw, options) => {
  if (!raw || !["llm", "heuristic"].includes(raw.source)
      || typeof raw.summary !== "string" || !Array.isArray(raw.idleBubbleCandidates)
      || !["low", "medium", "high"].includes(raw.privacyRisk)) throw new Error("invalid result");
  const diagnostic = raw.diagnostic;
  if (providers.has(options.provider) && (!diagnostic || diagnostic.provider !== options.provider
      || !["success", "fallback"].includes(diagnostic.status)
      || (diagnostic.status === "fallback" && !reasons.has(diagnostic.reason))
      || (raw.source === "llm" && diagnostic.status !== "success"))) throw new Error("invalid diagnostic");
  return {
    id: learningJobId(options), source: raw.source,
    summary: text(raw.summary, 220),
    idleBubbleCandidates: raw.idleBubbleCandidates.filter((item) => typeof item === "string").slice(0, 8).map((item) => text(item, 28)),
    socialBubbleCandidates: Array.isArray(raw.socialBubbleCandidates) ? raw.socialBubbleCandidates
      .filter((item) => item && typeof item === "object" && !Array.isArray(item)).slice(0, 6).map((item) => ({
        ...Object.fromEntries([["kind", 12], ["text", 56], ["locale", 8], ["intentId", 40], ["activity", 32]]
          .filter(([key]) => typeof item[key] === "string").map(([key, limit]) => [key, text(item[key], limit)])),
        ...Object.fromEntries([["replyToIntentIds", 4, 40], ["allowedVisitRoles", 2, 12], ["tags", 4, 18]]
          .map(([key, count, limit]) => [key, Array.isArray(item[key]) ? item[key]
            .filter((value) => typeof value === "string").slice(0, count).map((value) => text(value, limit)) : []])),
      })) : [],
    traitChanges: Object.fromEntries(["focus", "resilience", "curiosity", "efficiency", "creativity", "warmth"]
      .filter((trait) => Number.isFinite(raw.traitChanges?.[trait]))
      .map((trait) => [trait, Math.max(-1, Math.min(3, Math.round(raw.traitChanges[trait])))])),
    xp: Number.isFinite(raw.xp) ? Math.max(1, Math.min(8, Math.round(raw.xp))) : 1,
    confidence: Number.isFinite(raw.confidence) ? Math.max(0, Math.min(1, raw.confidence)) : 0.2,
    privacyRisk: raw.privacyRisk,
    ...(diagnostic && providers.has(options.provider) ? { diagnostic: {
      provider: options.provider, status: diagnostic.status,
      ...(diagnostic.status === "fallback" ? { reason: diagnostic.reason } : {}),
      timestamp: new Date().toISOString(),
    } } : {}),
  };
};

// Windows has no POSIX process groups. Terminate only the tree rooted at this
// job's actual spawned worker; an injected test process can never opt in via
// runLearningJob. The injectable runner lets this Windows path be checked on
// other hosts without issuing any real taskkill command.
export const terminateWindowsLearningTree = (child, {
  ownedChild = false,
  spawnTaskkill = spawn,
  systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows",
} = {}) => {
  const stopChild = () => { try { child?.kill("SIGKILL"); } catch { /* Already exited. */ } };
  if (!ownedChild || !Number.isInteger(child?.pid) || child.pid <= 0) {
    stopChild();
    return Promise.resolve();
  }
  return new Promise((resolveDone) => {
    let settled = false;
    const finish = (failed) => {
      if (settled) return;
      settled = true;
      if (failed) stopChild();
      resolveDone();
    };
    try {
      const killer = spawnTaskkill(win32.join(systemRoot, "System32", "taskkill.exe"),
        ["/PID", String(child.pid), "/T", "/F"], {
          shell: false, windowsHide: true, stdio: "ignore",
          timeout: 1500, killSignal: "SIGKILL",
        });
      killer.once("error", () => finish(true));
      killer.once("close", (code) => finish(code !== 0));
    } catch { finish(true); }
  });
};

export const runLearningJob = async (options, { spawnImpl = spawn } = {}) => {
  if (!options.learningScript || ![...providers, "none"].includes(options.provider)) {
    return failedLearning(options, "unavailable");
  }
  try {
    if (!(await stat(options.learningScript)).isFile()) return failedLearning(options, "unavailable");
  } catch { return failedLearning(options, "unavailable"); }
  const args = [options.learningScript, "--provider", options.provider, "--agent", options.agent,
    "--session", options.sessionId, "--status", options.status === "error" ? "error" : "complete",
    "--summary", text(options.summary, 220), "--learning-id", learningJobId(options), "--dry-run"];
  try {
    if (options.contextFile) args.push("--context-file", options.contextFile);
    else if (options.digest) {
      const directory = await mkdtemp(join(tmpdir(), "aivatar-learning-job-"));
      const path = join(directory, "digest.txt");
      await writeFile(path, text(options.digest, 2400), { encoding: "utf8", mode: 0o600 });
      args.push("--context-file", path);
    }
    if (options.avatarStateFile) args.push("--avatar-state-file", options.avatarStateFile);
  } catch { return failedLearning(options, "provider-error"); }
  return new Promise((resolveResult) => {
    let child;
    let settled = false;
    let stdout = "";
    let timer;
    // Only the default, real spawn can own a new process group. Injected test
    // doubles may carry fake PIDs and must never trigger process.kill(-pid).
    const ownsProcessGroup = process.platform !== "win32" && spawnImpl === spawn;
    const terminate = () => {
      if (process.platform === "win32") {
        void terminateWindowsLearningTree(child, { ownedChild: spawnImpl === spawn });
        return;
      }
      if (ownsProcessGroup && Number.isInteger(child?.pid) && child.pid > 0) {
        try { process.kill(-child.pid, "SIGKILL"); return; } catch { /* Already exited. */ }
      }
      try { child?.kill("SIGKILL"); } catch { /* Already exited. */ }
    };
    const finish = (learning) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult(learning);
    };
    const fail = (reason) => finish(failedLearning(options, reason));
    try {
      child = spawnImpl(options.nodeCommand ?? process.execPath, args, {
        shell: false, windowsHide: true,
        detached: ownsProcessGroup,
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, ...(options.env ?? {}) },
      });
      child.once("error", (error) => fail(["ENOENT", "EACCES", "ENOTDIR"].includes(error?.code) ? "unavailable" : "provider-error"));
      // Preserve Unicode when a multibyte character spans OS pipe chunks.
      child.stdout?.setEncoding?.("utf8");
      child.stdout?.on("data", (chunk) => {
        if (settled) return;
        stdout += chunk.toString("utf8");
        if (stdout.length > 1024 * 1024) { fail("invalid-output"); terminate(); }
      });
      child.once("close", (code) => {
        if (settled) return;
        if (code !== 0) { fail("provider-error"); return; }
        try { finish(workerResult(JSON.parse(stdout), options)); }
        catch { fail("invalid-output"); }
      });
      timer = setTimeout(() => { fail("timeout"); terminate(); }, Math.max(1, Math.min(180000, options.timeoutMs ?? 120000)));
    } catch { fail("unavailable"); }
  });
};

// Short-lived hook processes launch this supervisor independently. It owns the
// timeout, worker pipes and HTTP delivery even after the hook itself exits.
const main = async () => {
  const index = process.argv.indexOf("--job-file");
  if (index < 0 || !process.argv[index + 1]) throw new Error("missing job");
  const body = await readFile(process.argv[index + 1], "utf8");
  if (body.length > 32768) throw new Error("oversized job");
  const options = JSON.parse(body);
  const endpoint = new URL(options.endpoint ?? "http://127.0.0.1:38988/agent-status");
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) throw new Error("invalid endpoint");
  const learning = await runLearningJob(options);
  const response = await fetch(endpoint, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(learningStatus(options, learning)), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("delivery failed");
};
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.warn("[aivatar-learning-job] Learning delivery failed"); process.exitCode = 1; });
}
