// Provider envelopes and diagnostics are kept separate from the worker so they
// can be tested without launching an LLM or reading any user configuration.
const reasons = new Set([
  "unavailable", "authentication", "timeout", "invalid-output",
  "empty-candidates", "provider-error",
]);

export class LearningProviderError extends Error {
  constructor(reason) {
    super(reasons.has(reason) ? reason : "provider-error");
    this.reason = this.message;
  }
}

export const classifyProviderFailure = (error) => {
  if (error instanceof LearningProviderError) return error.reason;
  if (["ENOENT", "EACCES", "ENOTDIR"].includes(error?.code)) return "unavailable";
  if (["ETIMEDOUT", "ETIME"].includes(error?.code)) return "timeout";
  // This text is used only to select an enum. Never retain or return it.
  const text = String(error?.message ?? error ?? "");
  if (/\b(?:timed? ?out|timeout)\b/iu.test(text)) return "timeout";
  if (/\b(?:unauthorized|authentication(?:error)?|not logged in|not authenticated|invalid (?:x-)?api[- ]key|api key (?:is )?(?:missing|required|not found)|login required|please (?:log|sign) in|401)\b/iu.test(text)) {
    return "authentication";
  }
  return "provider-error";
};

export const learningDiagnostic = (provider, status, reason) => ({
  provider,
  status,
  ...(status === "fallback" ? { reason: reasons.has(reason) ? reason : "provider-error" } : {}),
  timestamp: new Date().toISOString(),
});

export const extractJsonObject = (text) => {
  const trimmed = String(text ?? "").replace(/^\uFEFF/u, "").trim();
  if (!trimmed) throw new LearningProviderError("invalid-output");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* fail below */ }
    }
    throw new LearningProviderError("invalid-output");
  }
};

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
const isLearning = (value) => isObject(value)
  && typeof value.summary === "string" && Array.isArray(value.idleBubbleCandidates);

export const unwrapProviderJson = (value, depth = 0) => {
  if (depth > 6) throw new LearningProviderError("invalid-output");
  if (typeof value === "string") return unwrapProviderJson(extractJsonObject(value), depth + 1);
  if (value?.is_error === true || value?.type === "error" || /^error(?:_|$)/u.test(value?.subtype ?? "")) {
    throw new LearningProviderError(classifyProviderFailure(
      new Error(JSON.stringify(value.error ?? value.errors ?? value.result ?? "")),
    ));
  }
  if (isLearning(value)) return value;
  // Claude's structured result takes precedence over result: "" or prose.
  for (const key of ["structured_output", "result", "response", "content"]) {
    const inner = value?.[key];
    if (inner === undefined || inner === null || inner === "") continue;
    try {
      if (Array.isArray(inner)) {
        const text = inner.filter((part) => !part?.type || part.type === "text")
          .map((part) => part?.text ?? part?.content ?? "").filter((part) => typeof part === "string").join("\n");
        if (text) return unwrapProviderJson(text, depth + 1);
      } else {
        return unwrapProviderJson(inner, depth + 1);
      }
    } catch (error) {
      if (error.reason !== "invalid-output") throw error;
    }
  }
  throw new LearningProviderError("invalid-output");
};

export const parseClaudeOutput = (stdout) => unwrapProviderJson(extractJsonObject(stdout));

export const parseOpencodeOutput = (stdout) => {
  const snippets = [];
  let direct;
  for (const line of String(stdout).split(/\r?\n/u)) {
    let event;
    try { event = JSON.parse(line.trim()); } catch { continue; }
    if (event?.type === "error" || event?.type === "session.error") {
      throw new LearningProviderError(classifyProviderFailure(
        new Error(JSON.stringify(event.error ?? event.properties?.error ?? "")),
      ));
    }
    if (isLearning(event)) direct = event;
    // Only assistant text: never harvest reasoning or tool results as a reply.
    if (event?.type && !["text", "message.part.updated", "result", "response"].includes(event.type)) continue;
    const part = event.part ?? event.properties?.part;
    if (part && (!part.type || part.type === "text") && typeof part.text === "string") {
      snippets.push(part.text);
      continue;
    }
    for (const candidate of [event.result, event.response, event.content, event.text, event.message, event.data?.text, event.data?.message]) {
      if (typeof candidate === "string" && candidate.trim()) { snippets.push(candidate); break; }
      if (isLearning(candidate)) direct = candidate;
    }
    const parts = event.parts ?? event.data?.parts;
    for (const part of Array.isArray(parts) ? parts : []) {
      if (part?.type && part.type !== "text") continue;
      const text = part?.text ?? part?.content;
      if (typeof text === "string") snippets.push(text);
    }
  }
  // Most versions emit a complete final text part; some adapters emit deltas.
  for (const text of [...snippets].reverse()) {
    try { return unwrapProviderJson(extractJsonObject(text)); } catch (error) {
      if (error.reason !== "invalid-output") throw error;
    }
  }
  if (direct) return direct;
  return unwrapProviderJson(extractJsonObject(snippets.length ? snippets.join("") : stdout));
};

export const claudeLearningArgs = (schema) => [
  // Requires Claude Code 2.1.169+. Unlike --bare, safe mode keeps subscription
  // authentication while disabling user/project hooks, plugins and context.
  // Enterprise managed policy still takes precedence, as required by the CLI.
  "--safe-mode",
  "--print",
  "--output-format", "json",
  "--json-schema", JSON.stringify(schema),
  "--tools", "",
  "--disallowedTools", "mcp__*",
  "--strict-mcp-config",
  "--mcp-config", '{"mcpServers":{}}',
  "--disable-slash-commands",
  "--settings", '{"disableAllHooks":true}',
  "--no-session-persistence",
];

export const opencodeLearningConfig = (inlineConfig, agentName) => {
  let inherited = {};
  if (inlineConfig) {
    try {
      inherited = JSON.parse(inlineConfig);
      if (!isObject(inherited)) throw new Error();
    } catch {
      // Do not silently discard a caller's provider/model configuration.
      throw new LearningProviderError("provider-error");
    }
  }
  return JSON.stringify({
    ...inherited,
    share: "disabled",
    permission: "deny",
    agent: {
      ...(isObject(inherited.agent) ? inherited.agent : {}),
      // A unique name prevents configured build/plan permissions from
      // overriding our deny rules. Agent rules follow global permissions.
      [agentName]: {
        description: "Generate short companion phrases from the supplied digest only",
        mode: "primary",
        prompt: "Return only the requested JSON using only the supplied digest. Do not use tools, read files, access MCP, browse, run commands, or delegate.",
        permission: "deny",
        tools: { "*": false },
      },
    },
  });
};
