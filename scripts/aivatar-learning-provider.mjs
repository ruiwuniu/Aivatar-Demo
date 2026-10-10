// Provider envelopes and diagnostics are kept separate from the worker so they
// can be tested without launching an LLM or reading any user configuration.
const reasons = new Set([
  "unavailable", "authentication", "timeout", "invalid-output",
  "empty-candidates", "provider-error", "incompatible-client", "invalid-schema",
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
  // A terminal model/client failure is more useful than unrelated MCP auth
  // warnings that may precede it in a legacy CLI's startup output.
  if (/requires? (?:a )?newer version of (?:codex|claude|opencode|codebuddy)|(?:codex|claude|opencode|codebuddy).{0,40}(?:client|version).{0,30}(?:too old|outdated)|(?:unknown|unrecognized|unsupported|unexpected) (?:option|argument|flag)|invalid option.*--/iu.test(text)) return "incompatible-client";
  if (/invalid_json_schema|invalid schema for (?:response_format|text\.format)|schema must have a ['"]type['"] key/iu.test(text)) return "invalid-schema";
  if (/\b(?:timed? ?out|timeout)\b/iu.test(text)) return "timeout";
  if (/\b(?:unauthorized|authentication(?:error)?|not logged in|not authenticated|invalid (?:x-)?api[- ]key|api key (?:is )?(?:missing|required|not found)|login required|please (?:log|sign) in|401)\b/iu.test(text)) {
    return "authentication";
  }
  return "provider-error";
};

// Keep this order in sync with the native desktop learning resolver. Explicit
// command overrides are handled by the caller and always take precedence.
export const codexDesktopCandidates = (home) => [
  "/Applications",
  ...(typeof home === "string" && home.startsWith("/") ? [`${home.replace(/\/$/u, "")}/Applications`] : []),
].flatMap((root) => [
  `${root}/Codex.app/Contents/Resources/codex-cli/bin/codex`,
  `${root}/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`,
  `${root}/Codex.app/Contents/Resources/codex`,
]);

export const codexLearningArgs = (schemaPath, outputPath) => [
  "--ask-for-approval", "never", "exec",
  "--sandbox", "read-only", "--ephemeral", "--ignore-rules",
  // Retain normal Codex sign-in while keeping this one-shot generation
  // independent of working-session model, plugin, MCP and hook configuration.
  "--ignore-user-config",
  "--config", "features.plugins=false",
  "--config", "features.hooks=false",
  "--config", "features.apps=false",
  "--config", "features.memories=false",
  "--config", "features.shell_tool=false",
  "--config", "features.unified_exec=false",
  "--config", "features.multi_agent=false",
  "--config", "project_doc_max_bytes=0",
  "--config", 'web_search="disabled"',
  "--skip-git-repo-check", "--output-schema", schemaPath,
  "--output-last-message", outputPath, "-",
];

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

// Probe only public CLI metadata; do not inspect authentication or config files.
export const parseCliVersion = (text) => {
  const match = String(text).trim().match(/(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?(?:\s|$)/u);
  return match ? match.slice(1, 4).map(Number) : null;
};
export const compareCliVersions = (a, b) => {
  for (let i = 0; i < 3; i += 1) { const delta = (a?.[i] ?? 0) - (b?.[i] ?? 0); if (delta) return delta; }
  return 0;
};
const hasFlag = (help, flag) => new RegExp(`${flag}(?=[\\s=,<]|$)`, "u").test(help);
export const codebuddyRequiredFlags = [
  "--print", "--output-format", "--json-schema", "--tools", "--disallowedTools",
  "--strict-mcp-config", "--mcp-config", "--settings", "--setting-sources",
  "--no-session-persistence", "--system-prompt",
];
export const compatibleProviderCommand = async (provider, candidates, probe) => {
  const failures = [];
  const results = await Promise.all(candidates.map(async (command) => {
    try {
      if (!command) throw new LearningProviderError("unavailable");
      const version = parseCliVersion(await probe(command, ["--version"]));
      let help;
      if (provider === "claude-code") {
        if (version && compareCliVersions(version, [2, 1, 169]) < 0) throw new LearningProviderError("incompatible-client");
        // Claude explicitly documents that --help omits some supported flags.
        if (!version && !hasFlag(await probe(command, ["--help"]), "--safe-mode")) throw new LearningProviderError("incompatible-client");
      } else if (provider === "opencode") {
        if (!version || ![1, 2].includes(version[0])) throw new LearningProviderError("incompatible-client");
        help = await probe(command, ["run", "--help"]);
        if (!["--format", "--agent", ...(version[0] === 2 ? ["--standalone"] : [])].every((flag) => hasFlag(help, flag))) throw new LearningProviderError("incompatible-client");
      } else if (provider === "codebuddy") {
        help = await probe(command, ["--help"]);
        if (!codebuddyRequiredFlags.every((flag) => hasFlag(help, flag))) throw new LearningProviderError("incompatible-client");
        // The public 2.164.0 implementation treats an empty setting-sources
        // value as DEFAULT_SCOPES; use its explicit `none` mode instead.
        if (!version || compareCliVersions(version, [2, 164, 0]) < 0) throw new LearningProviderError("incompatible-client");
      }
      return { command, version };
    } catch (error) { failures.push(classifyProviderFailure(error)); return null; }
  }));
  const supported = results.filter(Boolean).sort((a, b) => compareCliVersions(b.version, a.version));
  if (supported.length) return supported[0];
  const reason = ["incompatible-client", "timeout", "authentication", "provider-error", "unavailable"].find((item) => failures.includes(item));
  throw new LearningProviderError(reason ?? "unavailable");
};

export const codebuddyLearningArgs = (schema) => [
  "--print", "--output-format", "json", "--json-schema", JSON.stringify(schema),
  // CodeBuddy 2.164.0 implements --json-schema through this built-in encoder.
  // It only validates/stores the response in memory. An empty --tools value or
  // wildcard deny also removes it, so allow precisely this output-only tool.
  "--tools", "StructuredOutput", "--disallowedTools", "mcp__*", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
  "--setting-sources", "none",
  "--settings", '{"disableAllHooks":true,"autoMemoryEnabled":false,"enabledPlugins":{}}',
  "--system-prompt", "Use StructuredOutput once to return the requested JSON from the supplied digest. Do not use any other tools or load other context.",
  "--no-session-persistence",
];

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

export const opencodeLearningConfig = (inlineConfig, agentName, major = 1) => {
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
  if (major === 2) {
    const deny = [{ action: "*", resource: "*", effect: "deny" }];
    return JSON.stringify({
      // Retain caller-selected model/provider transport, never executable
      // plugin/MCP/command configuration, in the isolated learning runtime.
      ...(inherited.model !== undefined ? { model: inherited.model } : {}),
      ...(isObject(inherited.providers) ? { providers: inherited.providers } : {}),
      ...(isObject(inherited.provider) ? { provider: inherited.provider } : {}),
      share: "disabled", update: "disable", snapshots: false, warming: false,
      permissions: deny,
      plugins: ["-opencode.config.mcp", "-opencode.config.skill", "-opencode.config.instruction", "-opencode.config.command"],
      agents: { [agentName]: {
        description: "Generate short companion phrases from the supplied digest only",
        mode: "primary",
        system: "Return only the requested JSON using only the supplied digest. Do not use tools, read files, browse, run commands, or delegate.",
        permissions: deny,
      } },
    });
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
