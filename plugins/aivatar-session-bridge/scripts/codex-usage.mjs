import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const codexHome = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
const baselinePath =
  process.env.AIVATAR_USAGE_BASELINE_PATH ??
  path.join(codexHome, "tmp", "aivatar-usage-baselines.json");
const baselineTtlMs = Number(process.env.AIVATAR_USAGE_BASELINE_TTL_MS ?? 21600000);

const usageFields = [
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
];

const toCamelUsage = (usage, scope, context) => {
  const next = {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    outputTokens: usage.output_tokens,
    reasoningOutputTokens: usage.reasoning_output_tokens,
    totalTokens: usage.total_tokens,
    source: "codex-desktop-jsonl",
    scope,
  };

  if (
    Number.isFinite(context?.contextTokens) &&
    context.contextTokens > 0 &&
    Number.isFinite(context?.modelContextWindow) &&
    context.modelContextWindow > 0
  ) {
    next.contextTokens = context.contextTokens;
    next.modelContextWindow = context.modelContextWindow;
  }

  return next;
};

const emptyUsage = () =>
  Object.fromEntries(usageFields.map((field) => [field, 0]));

const subtractUsage = (current, baseline) => {
  const next = emptyUsage();
  for (const field of usageFields) {
    next[field] = Math.max(0, (current?.[field] ?? 0) - (baseline?.[field] ?? 0));
  }
  return next;
};

const isUsage = (value) =>
  value &&
  typeof value === "object" &&
  Number.isFinite(value.total_tokens);

const readBaselines = async () => {
  try {
    const baselines = JSON.parse(await fs.readFile(baselinePath, "utf8"));
    const now = Date.now();
    let changed = false;

    for (const [sessionId, baseline] of Object.entries(baselines)) {
      const ageMs = baseline?.createdAt
        ? now - Date.parse(baseline.createdAt)
        : 0;
      if (baseline?.createdAt && ageMs > baselineTtlMs) {
        delete baselines[sessionId];
        changed = true;
      }
    }

    if (changed) {
      await writeBaselines(baselines);
    }

    return baselines;
  } catch {
    return {};
  }
};

const writeBaselines = async (baselines) => {
  await fs.mkdir(path.dirname(baselinePath), { recursive: true });
  await fs.writeFile(baselinePath, JSON.stringify(baselines, null, 2));
};

const walk = async function* (directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walk(entryPath);
    } else {
      yield entryPath;
    }
  }
};

export const findRolloutPath = async (sessionId) => {
  if (process.env.CODEX_ROLLOUT_PATH) return process.env.CODEX_ROLLOUT_PATH;
  if (!sessionId) return null;

  const sessionsRoot = path.join(codexHome, "sessions");
  let newest = null;
  let newestMtime = 0;

  for await (const filePath of walk(sessionsRoot)) {
    if (!filePath.endsWith(".jsonl") || !filePath.includes(sessionId)) continue;
    const stat = await fs.stat(filePath);
    if (stat.mtimeMs > newestMtime) {
      newest = filePath;
      newestMtime = stat.mtimeMs;
    }
  }

  return newest;
};

export const readLatestTokenUsage = async (sessionId) => {
  const rolloutPath = await findRolloutPath(sessionId);
  if (!rolloutPath) return null;

  const content = await fs.readFile(rolloutPath, "utf8");
  let latest = null;

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    const payload = record?.payload;
    if (payload?.type !== "token_count") continue;

    const info = payload.info ?? {};
    const total = info.total_token_usage;
    const last = info.last_token_usage;
    if (!isUsage(total)) continue;

    const modelContextWindow = Number(info.model_context_window);

    latest = {
      timestamp: record.timestamp,
      total,
      last: isUsage(last) ? last : null,
      modelContextWindow:
        Number.isFinite(modelContextWindow) && modelContextWindow > 0
          ? modelContextWindow
          : null,
    };
  }

  return latest;
};

export const ensureUsageBaseline = async (sessionId, options = {}) => {
  const latest = await readLatestTokenUsage(sessionId);
  if (!latest) return null;

  const baselines = await readBaselines();
  const existing = baselines[sessionId];
  const ageMs = existing?.createdAt
    ? Date.now() - Date.parse(existing.createdAt)
    : 0;
  const expired = existing?.createdAt && ageMs > baselineTtlMs;

  if (!existing || options.reset || expired) {
    const now = new Date().toISOString();
    baselines[sessionId] = {
      createdAt: now,
      updatedAt: now,
      status: options.status ?? "active",
      timestamp: latest.timestamp,
      total: latest.total,
    };
    await writeBaselines(baselines);
  } else if (options.status && existing.status !== options.status) {
    baselines[sessionId] = {
      ...existing,
      updatedAt: new Date().toISOString(),
      status: options.status,
    };
    await writeBaselines(baselines);
  }

  return baselines[sessionId];
};

export const clearUsageBaseline = async (sessionId) => {
  if (!sessionId) return false;
  const baselines = await readBaselines();
  if (!baselines[sessionId]) return false;
  delete baselines[sessionId];
  await writeBaselines(baselines);
  return true;
};

export const getUsageDelta = async (sessionId, options = {}) => {
  const latest = await readLatestTokenUsage(sessionId);
  if (!latest) return null;

  const baselines = await readBaselines();
  const baseline = baselines[sessionId];
  const rawUsage = baseline?.total
    ? subtractUsage(latest.total, baseline.total)
    : latest.last;

  if (options.clearBaseline && baselines[sessionId]) {
    delete baselines[sessionId];
    await writeBaselines(baselines);
  }

  if (!isUsage(rawUsage) || rawUsage.total_tokens <= 0) return null;

  return {
    usage: rawUsage,
    scope: baseline?.total ? "since-baseline" : "last-turn",
    timestamp: latest.timestamp,
    context:
      latest.last && latest.modelContextWindow
        ? {
            contextTokens: latest.last.total_tokens,
            modelContextWindow: latest.modelContextWindow,
          }
        : null,
  };
};

export const getContextUsage = async (sessionId) => {
  const latest = await readLatestTokenUsage(sessionId);
  if (!latest?.last || !latest.modelContextWindow) return null;

  return {
    usage: latest.last,
    scope: "context-window",
    timestamp: latest.timestamp,
    context: {
      contextTokens: latest.last.total_tokens,
      modelContextWindow: latest.modelContextWindow,
    },
  };
};

export const toAivatarUsage = (result) =>
  result?.usage ? toCamelUsage(result.usage, result.scope, result.context) : null;
