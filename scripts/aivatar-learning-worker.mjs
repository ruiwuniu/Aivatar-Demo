#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

const endpoint =
  process.env.AIVATAR_HTTP_ENDPOINT ?? "http://127.0.0.1:38988/agent-status";
const defaultAvatarStateFile =
  process.env.AIVATAR_AVATAR_STATE_PATH ??
  join(tmpdir(), "aivatar-avatar-state.json");
const defaultTimeoutMs = Math.max(
  5000,
  Number(process.env.AIVATAR_LEARNING_TIMEOUT_MS ?? 30000),
);
const configuredCodexCommand =
  process.env.AIVATAR_CODEX_COMMAND ??
  process.env.CODEX_COMMAND ??
  null;
const defaultCodexCommand = process.platform === "win32" ? "codex.cmd" : "codex";
const claudeCommand = process.env.AIVATAR_CLAUDE_COMMAND ?? "claude";

const traitNames = [
  "focus",
  "resilience",
  "curiosity",
  "efficiency",
  "creativity",
  "warmth",
];

const learningSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    idleBubbleCandidates: {
      type: "array",
      items: { type: "string" },
      maxItems: 6,
    },
    traitChanges: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        traitNames.map((trait) => [
          trait,
          { type: "integer", minimum: -3, maximum: 3 },
        ]),
      ),
      required: traitNames,
    },
    xp: { type: "integer", minimum: 1, maximum: 8 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    privacyRisk: { enum: ["low", "medium", "high"] },
  },
  required: [
    "summary",
    "idleBubbleCandidates",
    "traitChanges",
    "xp",
    "confidence",
    "privacyRisk",
  ],
};

const usage = `Usage:
  node scripts/aivatar-learning-worker.mjs --provider claude-code --agent codex --session SESSION --status complete --summary "Task finished"
  node scripts/aivatar-learning-worker.mjs --provider codex --agent claude-code --session SESSION --context-file digest.txt

Options:
  --provider <claude-code|codex|none>
  --agent <name>
  --session <id>
  --status <idle|thinking|executing|waiting_for_user|error|complete>
  --summary <text>
  --context-file <path>
  --avatar-state-file <path>
  --dry-run
`;

const parseArgs = (argv) => {
  const options = {
    provider:
      process.env.AIVATAR_LEARNING_PROVIDER ??
      process.env.AIVATAR_PROVIDER ??
      "claude-code",
    agent: process.env.AIVATAR_AGENT ?? "codex",
    sessionId: process.env.AIVATAR_SESSION_ID,
    status: "complete",
    summary: "",
    contextFile: undefined,
    avatarStateFile: process.env.AIVATAR_AVATAR_STATE_FILE ?? defaultAvatarStateFile,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      console.log(usage);
      process.exit(0);
    }
    if (value === "--provider") {
      options.provider = argv[index + 1] ?? options.provider;
      index += 1;
      continue;
    }
    if (value === "--agent") {
      options.agent = argv[index + 1] ?? options.agent;
      index += 1;
      continue;
    }
    if (value === "--session" || value === "--session-id") {
      options.sessionId = argv[index + 1] ?? options.sessionId;
      index += 1;
      continue;
    }
    if (value === "--status") {
      options.status = argv[index + 1] ?? options.status;
      index += 1;
      continue;
    }
    if (value === "--summary") {
      options.summary = argv[index + 1] ?? options.summary;
      index += 1;
      continue;
    }
    if (value === "--context-file") {
      options.contextFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--avatar-state-file") {
      options.avatarStateFile = argv[index + 1] ?? options.avatarStateFile;
      index += 1;
      continue;
    }
    if (value === "--dry-run") {
      options.dryRun = true;
    }
  }

  return options;
};

const hasHanText = (value) => /[\u3400-\u9fff]/u.test(value);

const cp1252ByteMap = new Map(
  Object.entries({
    "\u20ac": 0x80,
    "\u201a": 0x82,
    "\u0192": 0x83,
    "\u201e": 0x84,
    "\u2026": 0x85,
    "\u2020": 0x86,
    "\u2021": 0x87,
    "\u02c6": 0x88,
    "\u2030": 0x89,
    "\u0160": 0x8a,
    "\u2039": 0x8b,
    "\u0152": 0x8c,
    "\u017d": 0x8e,
    "\u2018": 0x91,
    "\u2019": 0x92,
    "\u201c": 0x93,
    "\u201d": 0x94,
    "\u2022": 0x95,
    "\u2013": 0x96,
    "\u2014": 0x97,
    "\u02dc": 0x98,
    "\u2122": 0x99,
    "\u0161": 0x9a,
    "\u203a": 0x9b,
    "\u0153": 0x9c,
    "\u017e": 0x9e,
    "\u0178": 0x9f,
  }),
);

const repairLikelyMojibakeText = (value) => {
  const text = String(value ?? "");
  if (hasHanText(text)) return text;
  if (!/[ÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöùúûüýþÿ]/u.test(text)) {
    return text;
  }

  try {
    const bytes = [];
    for (const char of text) {
      const code = char.codePointAt(0) ?? 0;
      if (code <= 0xff) {
        bytes.push(code);
      } else if (cp1252ByteMap.has(char)) {
        bytes.push(cp1252ByteMap.get(char));
      } else {
        return text;
      }
    }
    const repaired = Buffer.from(bytes).toString("utf8");
    return hasHanText(repaired) ? repaired : text;
  } catch {
    return text;
  }
};

const compactText = (value, limit) =>
  repairLikelyMojibakeText(value)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Za-z]:\\[^\s"'<>]+/g, "[path]")
    .replace(/(?:[./]|\\\\)[^\s"'<>]*[\\/][^\s"'<>]+/g, "[path]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "[secret]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);

const normalizeBubblePhrase = (value) => {
  const compact = compactText(value, 80);
  if (!compact || /\[(?:url|path|email|secret)\]/i.test(compact)) return "";
  if (/[{}()[\];=<>]{3,}/.test(compact)) return "";
  return compact
    .replace(/['’]/g, "")
    .replace(/\p{P}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const safePhrase = (value) => {
  const phrase = normalizeBubblePhrase(value);
  const length = Array.from(phrase).length;
  if (length < 2 || length > 28) return null;
  return phrase;
};

const detectSessionLanguage = (options, digest) => {
  const text = `${options.summary} ${digest}`;
  if (hasHanText(text)) return "zh";
  return "en";
};

const normalizeLearning = (raw, options, digest) => {
  const summary = compactText(raw?.summary, 180);
  if (!summary) throw new Error("Learning result is missing summary");

  const traitChanges = {};
  for (const trait of traitNames) {
    const value = Number(raw?.traitChanges?.[trait]);
    if (Number.isFinite(value) && value !== 0) {
      traitChanges[trait] = Math.max(-3, Math.min(3, Math.round(value)));
    }
  }

  const candidates = Array.isArray(raw?.idleBubbleCandidates)
    ? raw.idleBubbleCandidates.map(safePhrase).filter(Boolean).slice(0, 6)
    : [];
  const xp = Number(raw?.xp);
  const confidence = Number(raw?.confidence);
  const privacyRisk =
    raw?.privacyRisk === "medium" || raw?.privacyRisk === "high"
      ? raw.privacyRisk
      : "low";
  const idSeed = JSON.stringify({
    provider: options.provider,
    agent: options.agent,
    sessionId: options.sessionId,
    status: options.status,
    summary,
    digest,
  });

  return {
    id: createHash("sha256").update(idSeed).digest("hex").slice(0, 16),
    source: options.provider === "none" ? "heuristic" : "llm",
    summary,
    idleBubbleCandidates: candidates,
    traitChanges,
    xp: Number.isFinite(xp) ? Math.max(1, Math.min(8, Math.round(xp))) : 3,
    confidence:
      Number.isFinite(confidence) && confidence >= 0
        ? Math.min(1, confidence)
        : 0.5,
    privacyRisk,
  };
};

const normalizeAvatarState = (value) => {
  if (!value || typeof value !== "object") return null;
  const sourceTraits = value.growth?.traits ?? value.traits ?? {};
  const traits = {};
  for (const trait of traitNames) {
    const next = Number(sourceTraits[trait]);
    traits[trait] = Number.isFinite(next) && next >= 0 ? Math.round(next) : 0;
  }
  const level = Number(value.growth?.level ?? value.level);
  const dominantTrait = traitNames.reduce(
    (best, trait) => (traits[trait] > traits[best] ? trait : best),
    traitNames[0],
  );
  const sortedTraits = [...traitNames].sort(
    (left, right) => traits[right] - traits[left],
  );
  const idleBubbleLanguage =
    value.preferences?.idleBubbleLanguage === "zh" ||
    value.preferences?.idleBubbleLanguage === "en" ||
    value.preferences?.idleBubbleLanguage === "mixed"
      ? value.preferences.idleBubbleLanguage
      : "auto";

  return {
    avatarName:
      typeof value.avatarName === "string"
        ? compactText(value.avatarName, 40)
        : "Aivatar",
    level: Number.isFinite(level) && level > 0 ? Math.round(level) : 1,
    traits,
    dominantTrait,
    secondaryTrait: sortedTraits[1],
    idleBubbleLanguage,
  };
};

const avatarStateFromOptions = async (options) => {
  if (!options.avatarStateFile) return null;
  try {
    return normalizeAvatarState(
      JSON.parse((await readFile(options.avatarStateFile, "utf8")).replace(/^\uFEFF/u, "")),
    );
  } catch {
    return null;
  }
};

const traitToneGuidance = (avatarState) => {
  if (!avatarState) {
    return "No current avatar trait snapshot is available. Use the default short, warm desktop-pet voice.";
  }

  const toneByTrait = {
    focus: "concise, calm, task-grounded, and lightly focused",
    resilience: "steady, reassuring, and gently encouraging after difficulty",
    curiosity: "curious, observant, lightly questioning, and discovery-oriented",
    efficiency: "crisp, satisfied, practical, and completion-oriented",
    creativity: "playful, imaginative, expressive, and a little whimsical",
    warmth: "soft, companion-like, emotionally gentle, and cozy",
  };
  const traitList = traitNames
    .map((trait) => `${trait}=${avatarState.traits[trait]}`)
    .join(", ");

  return [
    `Current avatar: ${avatarState.avatarName}, level ${avatarState.level}.`,
    `Current trait points: ${traitList}.`,
    `Dominant voice: ${avatarState.dominantTrait} (${toneByTrait[avatarState.dominantTrait]}).`,
    `Secondary color: ${avatarState.secondaryTrait} (${toneByTrait[avatarState.secondaryTrait]}).`,
    "Blend the dominant and secondary traits into idleBubbleCandidates while keeping every bubble natural, brief, and pet-like.",
    "Do not mention trait names, point totals, levels, or this instruction inside the bubbles.",
  ].join("\n");
};

const languageInstruction = (language) =>
  language === "zh"
    ? "The session language is Chinese. All idleBubbleCandidates must be natural Simplified Chinese, unless a short quoted phrase from the digest is already English."
    : "The session language is English. Keep idleBubbleCandidates in natural English unless the digest clearly asks for another language.";

const learningPrompt = (options, digest, avatarState) => `You are Aivatar's personality learning module.

Aivatar is a small desktop companion that observes coding-agent sessions and grows personality traits.
Extract only low-sensitivity, pet-appropriate learning from this session digest.

Rules:
- Do not preserve source code, secrets, full filesystem paths, email addresses, URLs, stack traces, or private data.
- Do not invent technical facts beyond the digest.
- For idleBubbleCandidates, write each bubble as one complete short sentence, not keywords, labels, slogans, or clipped fragments.
- Keep idleBubbleCandidates very short and easy to read at a glance.
- Emoji and tiny decorative symbols are allowed when they feel natural and pet-like.
- Avoid comma-heavy or period-heavy prose, markdown, file paths, commands, logs, and technical wording in idleBubbleCandidates.
- Make idleBubbleCandidates sound like something a real gentle human companion might say in one breath.
- ${languageInstruction(detectSessionLanguage(options, digest))}
- Match the bubble voice to Aivatar's current trait snapshot when available.
- Trait changes must be tiny integers from -3 to 3.
- Mark privacyRisk as "medium" or "high" if the digest still seems sensitive.
- Return only valid JSON matching the requested schema.

Aivatar voice snapshot:
${traitToneGuidance(avatarState)}

Session:
- agent: ${options.agent}
- sessionId: ${options.sessionId ?? "default"}
- status: ${options.status}
- summary: ${compactText(options.summary, 260)}
- digest: ${digest}
`;

const runCommand = (command, args, stdin, timeoutMs = defaultTimeoutMs) =>
  new Promise((resolve, reject) => {
    const useCmdShim =
      process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
    const spawnCommand = useCmdShim ? "cmd.exe" : command;
    const spawnArgs = useCmdShim ? ["/d", "/c", command, ...args] : args;
    const child = spawn(spawnCommand, spawnArgs, {
      cwd: tmpdir(),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} exited ${code}: ${stderr || stdout}`));
      }
    });

    child.stdin.end(stdin);
  });

const fileExists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const envPathValue = () =>
  process.env.PATH ?? process.env.Path ?? process.env.path ?? "";

const resolveWindowsCodexJs = async (command = null) => {
  if (
    process.env.AIVATAR_CODEX_JS &&
    (await fileExists(process.env.AIVATAR_CODEX_JS))
  ) {
    return process.env.AIVATAR_CODEX_JS;
  }

  const dirs = command && /\.(cmd|bat)$/i.test(command) ? [dirname(command)] : [];
  dirs.push(...envPathValue().split(delimiter).filter(Boolean));

  for (const dir of dirs) {
    const codexCmd = join(dir, "codex.cmd");
    const codexJs = join(
      dir,
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );
    if ((await fileExists(codexCmd)) && (await fileExists(codexJs))) {
      return codexJs;
    }
  }

  return null;
};

const codexCommand = async () => {
  if (process.platform !== "win32") {
    return { command: configuredCodexCommand ?? defaultCodexCommand, prefixArgs: [] };
  }

  const codexJs = await resolveWindowsCodexJs(configuredCodexCommand);
  return codexJs
    ? { command: process.execPath, prefixArgs: [codexJs] }
    : { command: configuredCodexCommand ?? defaultCodexCommand, prefixArgs: [] };
};

const extractJsonObject = (text) => {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Provider returned empty output");

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Provider output is not JSON");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
};

const unwrapProviderJson = (value) => {
  if (typeof value?.result === "string") return extractJsonObject(value.result);
  if (typeof value?.response === "string") return extractJsonObject(value.response);
  if (typeof value?.content === "string") return extractJsonObject(value.content);
  if (Array.isArray(value?.content)) {
    const text = value.content
      .map((item) => item?.text ?? item?.content ?? "")
      .join("\n");
    if (text.trim()) return extractJsonObject(text);
  }
  return value;
};

const callClaudeCode = async (prompt) => {
  const { stdout } = await runCommand(
    claudeCommand,
    [
      "--bare",
      "--print",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(learningSchema),
      "--tools",
      "",
      "--no-session-persistence",
      prompt,
    ],
    "",
  );
  return unwrapProviderJson(extractJsonObject(stdout));
};

const callCodex = async (prompt) => {
  const runId = `${Date.now()}-${process.pid}`;
  const dir = join(tmpdir(), "aivatar-learning-worker");
  await mkdir(dir, { recursive: true });
  const schemaPath = join(dir, `${runId}.schema.json`);
  const outputPath = join(dir, `${runId}.output.json`);
  await writeFile(schemaPath, JSON.stringify(learningSchema, null, 2), "utf8");
  const codex = await codexCommand();

  await runCommand(
    codex.command,
    [
      ...codex.prefixArgs,
      "--ask-for-approval",
      "never",
      "exec",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--ignore-rules",
      "--skip-git-repo-check",
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      "-",
    ],
    prompt,
    Math.max(defaultTimeoutMs, 45000),
  );
  return unwrapProviderJson(extractJsonObject(await readFile(outputPath, "utf8")));
};

const conversationEntriesFromDigest = (digest) => {
  const text = compactText(digest, 2200);
  const entries = [];
  const pattern =
    /\b(user|assistant):\s*([\s\S]*?)(?=\s+(?:user|assistant|system|event|status|tool):|$)/giu;

  for (const match of text.matchAll(pattern)) {
    const role = match[1]?.toLowerCase();
    const content = compactText(match[2], 360);
    if ((role === "user" || role === "assistant") && content) {
      entries.push({ role, content });
    }
  }

  return entries.slice(-8);
};

const addUniquePhrase = (phrases, phrase) => {
  const safe = safePhrase(phrase);
  if (safe && !phrases.includes(safe)) phrases.push(safe);
};

const prependUniquePhrase = (phrases, phrase) => {
  const safe = safePhrase(phrase);
  if (safe && !phrases.includes(safe)) phrases.unshift(safe);
};

const heuristicBubbleCandidates = (options, digest, language) => {
  const phrases = [];
  const entries = conversationEntriesFromDigest(digest);
  const userText = entries
    .filter((entry) => entry.role === "user")
    .map((entry) => entry.content)
    .join(" ");
  const assistantText = entries
    .filter((entry) => entry.role === "assistant")
    .map((entry) => entry.content)
    .join(" ");
  const text = `${options.summary} ${digest} ${userText} ${assistantText}`.toLowerCase();
  const zh = language === "zh";
  const add = (...values) => values.forEach((value) => addUniquePhrase(phrases, value));
  const dominantTrait = options.avatarState?.dominantTrait;

  if (/8964|64|六四|天安门|1989|历史|记忆|纪念|民主|威权|社会韧性|镇压/u.test(text)) {
    add(
      zh ? "今天有点重量" : "Today feels weighty",
      zh ? "把这天记住" : "Remember this day",
      zh ? "历史在轻轻响" : "History is humming",
    );
  }

  if (/希望|担忧|未来|韧性|可能性|hope|worry|future|resilience/u.test(text)) {
    add(
      zh ? "希望还在闪" : "Hope still flickers",
      zh ? "陪你想一会" : "Thinking beside you",
      zh ? "这个问题很深" : "This question goes deep",
    );
  }

  if (/气泡|bubble|宠物|companion|personality|性格|学习|learn/u.test(text)) {
    add(
      zh ? "小气泡长出来" : "A bubble grew",
      zh ? "我学会一点语气" : "I learned the tone",
      zh ? "把语气收好" : "Tone tucked away",
    );
  }

  if (/debug|bug|error|failed|failure|fix|repair|修|错|失败|报错/u.test(text)) {
    add(
      zh ? "先稳住现场" : "Hold the scene steady",
      zh ? "一点点修回来" : "Patch it back gently",
      zh ? "问题会变小" : "The bug will shrink",
    );
  }

  if (/ui|visual|style|css|design|界面|样式|视觉|展示/u.test(text)) {
    add(
      zh ? "让界面会呼吸" : "Let the UI breathe",
      zh ? "颜色慢慢对齐" : "Colors finding home",
      zh ? "小细节发光" : "Tiny details glow",
    );
  }

  if (/test|build|verify|check|review|测试|构建|验证|检查/u.test(text)) {
    add(
      zh ? "检查也算前进" : "Checks count too",
      zh ? "跑完再放心" : "Verify, then rest",
      zh ? "稳稳过一遍" : "One steady pass",
    );
  }

  if (phrases.length === 0 && entries.length > 0) {
    add(
      zh ? "这轮我听见了" : "I heard this turn",
      zh ? "把对话收好" : "Conversation tucked in",
      zh ? "陪你慢慢想" : "Thinking slowly with you",
    );
  }

  if (phrases.length === 0) {
    add(
      zh ? "我学到一点点" : "I learned a little",
      zh ? "把这轮记住啦" : "Session thoughts saved",
      zh ? "小气泡收好" : "Tiny memory tucked away",
    );
  }

  if (dominantTrait === "focus") {
    prependUniquePhrase(phrases, zh ? "先收束重点" : "Gather the thread");
  } else if (dominantTrait === "resilience") {
    prependUniquePhrase(phrases, zh ? "稳稳修回来" : "Steady, then onward");
  } else if (dominantTrait === "curiosity") {
    prependUniquePhrase(phrases, zh ? "线索在发光" : "A clue is glowing");
  } else if (dominantTrait === "efficiency") {
    prependUniquePhrase(phrases, zh ? "干净收尾" : "Clean little finish");
  } else if (dominantTrait === "creativity") {
    prependUniquePhrase(phrases, zh ? "想法冒泡啦" : "Idea bubbles rising");
  } else if (dominantTrait === "warmth") {
    prependUniquePhrase(phrases, zh ? "陪你慢慢想" : "Thinking beside you");
  }

  return phrases.slice(0, 6);
};

const heuristicSummary = (options, digest, language) => {
  const entries = conversationEntriesFromDigest(digest);
  const latestUser = [...entries].reverse().find((entry) => entry.role === "user");
  const latestAssistant = [...entries]
    .reverse()
    .find((entry) => entry.role === "assistant");

  if (latestUser && latestAssistant) {
    return language === "zh"
      ? compactText(`Aivatar记住了一轮关于“${latestUser.content}”的对话`, 120)
      : compactText(`Aivatar noticed a conversation about "${latestUser.content}"`, 120);
  }

  return (
    compactText(options.summary || digest, 120) ||
    "Aivatar noticed this session and saved a small impression."
  );
};

const heuristicLearning = (options, digest) => {
  const text = `${options.summary} ${digest}`.toLowerCase();
  const language = detectSessionLanguage(options, digest);
  const traitChanges = {};
  if (/error|failed|failure|bug|fix|repair|debug/.test(text)) {
    traitChanges.resilience = 1;
  }
  if (/design|bubble|personality|ui|visual|paint|creative/.test(text)) {
    traitChanges.creativity = 1;
  }
  if (/learn|explore|why|idea|maybe|research/.test(text)) {
    traitChanges.curiosity = 1;
  }
  if (/test|verify|build|check|review/.test(text)) {
    traitChanges.focus = 1;
  }
  if (/complete|done|finished|success/.test(text)) {
    traitChanges.efficiency = 1;
  }
  if (/陪|温柔|cozy|warm|pet|companion/.test(text)) {
    traitChanges.warmth = 1;
  }

  return {
    summary: heuristicSummary(options, digest, language),
    idleBubbleCandidates: heuristicBubbleCandidates(options, digest, language),
    traitChanges,
    xp: 2,
    confidence: 0.35,
    privacyRisk: "low",
  };
};

const postLearning = async (options, learning) => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent: options.agent,
      sessionId: options.sessionId,
      status: options.status,
      phase: "session-learning",
      task: compactText(options.summary || learning.summary, 90),
      summary: compactText(options.summary || learning.summary, 90),
      progress: options.status === "complete" ? 100 : 50,
      message: compactText(options.summary || learning.summary, 90),
      severity: options.status === "error" ? "error" : "info",
      timestamp: new Date().toISOString(),
      learning,
    }),
  });
  if (!response.ok) throw new Error(await response.text());
};

const contextDigestFromOptions = async (options) => {
  const contextText = options.contextFile
    ? await readFile(options.contextFile, "utf8")
    : "";
  return compactText(contextText || options.summary, 1800);
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (!options.sessionId) {
    throw new Error("Missing --session SESSION_ID");
  }

  const digest = await contextDigestFromOptions(options);
  const avatarState = await avatarStateFromOptions(options);
  options.avatarState = avatarState;
  const prompt = learningPrompt(options, digest, avatarState);
  let raw;

  if (options.provider === "claude-code") {
    raw = await callClaudeCode(prompt);
  } else if (options.provider === "codex") {
    raw = await callCodex(prompt);
  } else if (options.provider === "none") {
    raw = heuristicLearning(options, digest);
  } else {
    throw new Error(`Unsupported provider: ${options.provider}`);
  }

  const learning = normalizeLearning(raw, options, digest);
  if (options.dryRun) {
    console.log(JSON.stringify(learning, null, 2));
    return;
  }

  await postLearning(options, learning);
  console.log(JSON.stringify({ ok: true, learning }, null, 2));
};

main().catch(async (error) => {
  const options = parseArgs(process.argv.slice(2));
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[aivatar-learning-worker] ${message}`);

  if (options.sessionId && options.provider !== "none") {
    try {
      const digest = await contextDigestFromOptions(options);
      const learning = normalizeLearning(
        heuristicLearning(options, digest),
        { ...options, provider: "none" },
        digest,
      );
      if (options.dryRun) {
        console.log(JSON.stringify(learning, null, 2));
      } else {
        await postLearning(options, learning);
      }
    } catch {
      // Learning must never interrupt the main status integration.
    }
  }
});
