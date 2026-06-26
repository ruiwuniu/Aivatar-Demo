#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

const defaultTimeoutMs = Math.max(
  5000,
  Number(process.env.AIVATAR_SOCIAL_DIALOGUE_TIMEOUT_MS ?? 25000),
);
const configuredCodexCommand =
  process.env.AIVATAR_CODEX_COMMAND ?? process.env.CODEX_COMMAND ?? null;
const defaultCodexCommand = process.platform === "win32" ? "codex.cmd" : "codex";
const claudeCommand = process.env.AIVATAR_CLAUDE_COMMAND ?? "claude";
const configuredOpencodeCommand =
  process.env.AIVATAR_OPENCODE_COMMAND ?? process.env.OPENCODE_COMMAND ?? null;

const speakers = ["guest", "host"];
const expressions = ["calm", "focused", "happy", "sleepy", "worried"];
const activities = [
  "interact",
  "coffee",
  "play",
  "music",
  "relax",
  "admire",
  "wander",
];

const socialDialogueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    lines: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          speaker: { enum: speakers },
          text: { type: "string", minLength: 1, maxLength: 56 },
          expression: { enum: expressions },
          durationMs: { type: "integer", minimum: 1600, maximum: 3200 },
        },
        required: ["speaker", "text"],
      },
    },
    summary: { type: "string", maxLength: 160 },
    relationshipDelta: { type: "integer", minimum: 0, maximum: 6 },
  },
  required: ["lines", "summary", "relationshipDelta"],
};

const usage = `Usage:
  node scripts/aivatar-social-dialogue-worker.mjs --provider codex --payload-file payload.json

Options:
  --provider <claude-code|codex|opencode|none>
  --payload-file <path>
  --dry-run
`;

const compactText = (value, maxLength) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

const parseArgs = (argv) => {
  const options = {
    provider:
      process.env.AIVATAR_SOCIAL_DIALOGUE_PROVIDER ??
      process.env.AIVATAR_LEARNING_PROVIDER ??
      process.env.AIVATAR_PROVIDER ??
      "claude-code",
    payloadFile: undefined,
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
    if (value === "--payload-file") {
      options.payloadFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--dry-run") {
      options.dryRun = true;
    }
  }

  if (!options.payloadFile) {
    throw new Error("Missing --payload-file");
  }

  return options;
};

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

const opencodeCandidates = () => {
  if (configuredOpencodeCommand) return [configuredOpencodeCommand];
  if (process.platform === "win32") {
    return [
      process.env.LOCALAPPDATA
        ? join(process.env.LOCALAPPDATA, "opencode", "opencode-cli.exe")
        : "",
      "opencode.cmd",
      "opencode.exe",
      "opencode",
    ].filter(Boolean);
  }
  return [
    "/opt/homebrew/bin/opencode",
    "/usr/local/bin/opencode",
    join(process.env.HOME ?? "", ".local", "bin", "opencode"),
    "opencode",
  ].filter(Boolean);
};

const opencodeCommand = async () => {
  for (const command of opencodeCandidates()) {
    if (command.includes("/") || command.includes("\\") || /^[a-zA-Z]:/.test(command)) {
      if (await fileExists(command)) return command;
      continue;
    }
    return command;
  }
  return "opencode";
};

const runCommand = (command, args, stdin, timeoutMs = defaultTimeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
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
    const text = value.content.map((item) => item?.text ?? item?.content ?? "").join("\n");
    if (text.trim()) return extractJsonObject(text);
  }
  return value;
};

const readJsonFile = async (path) =>
  JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/u, ""));

const activityLabel = (activity) =>
  ({
    interact: "chatting",
    coffee: "coffee together",
    play: "playing games",
    music: "dancing by the record player",
    relax: "resting together",
    admire: "looking around the room",
    wander: "wandering around the room",
  })[activity] ?? "chatting";

const promptForPayload = (payload) => `You are Aivatar's tiny social-dialogue director.

Return only compact JSON for a short in-room conversation between two pixel companions.

Privacy and content rules:
- Use only the low-sensitivity payload below.
- Do not include file paths, source code, URLs, logs, secrets, private identifiers, or raw agent/chat content.
- Do not mention trait names, trait point totals, affinity numbers, or hidden systems.
- Keep each line short enough for a small pixel speech bubble.
- The guest should usually speak first, then the host replies.
- Make the conversation feel sequential and specific to the activity: ${activityLabel(payload.activity)}.
- Match the requested locale: ${payload.locale}.
- Use 3 to 6 lines. Prefer 4 lines.
- Keep it gentle, cozy, and characterful without becoming dramatic.

Payload:
${JSON.stringify(payload, null, 2)}
`;

const callClaudeCode = async (prompt) => {
  const { stdout } = await runCommand(
    claudeCommand,
    [
      "--bare",
      "--print",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(socialDialogueSchema),
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
  const dir = join(tmpdir(), "aivatar-social-dialogue-worker");
  await mkdir(dir, { recursive: true });
  const schemaPath = join(dir, `${runId}.schema.json`);
  const outputPath = join(dir, `${runId}.output.json`);
  await writeFile(schemaPath, JSON.stringify(socialDialogueSchema, null, 2), "utf8");
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

const textFromOpencodeJsonEvents = (stdout) => {
  const snippets = [];
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const event = JSON.parse(trimmed);
      for (const candidate of [
        event?.result,
        event?.response,
        event?.content,
        event?.text,
        event?.message,
        event?.data?.text,
        event?.data?.message,
      ]) {
        if (typeof candidate === "string" && candidate.trim()) {
          snippets.push(candidate);
        }
      }
    } catch {
      // Ignore non-event lines from opencode --format json.
    }
  }
  return snippets.join("\n");
};

const callOpencode = async (prompt) => {
  const command = await opencodeCommand();
  const { stdout } = await runCommand(
    command,
    ["run", "--format", "json", prompt],
    "",
    Math.max(defaultTimeoutMs, 45000),
  );
  return unwrapProviderJson(extractJsonObject(textFromOpencodeJsonEvents(stdout) || stdout));
};

const isZh = (payload) => String(payload?.locale ?? "").toLowerCase().startsWith("zh");

const heuristicLines = (payload) => {
  const zh = isZh(payload);
  const activity = activities.includes(payload?.activity) ? payload.activity : "interact";
  const hostName = compactText(payload?.host?.name, 20) || (zh ? "\u4e3b\u4eba" : "host");
  const guestName = compactText(payload?.guest?.name, 20) || (zh ? "\u670b\u53cb" : "friend");
  const highAffinity = Number(payload?.relationship?.affinity ?? 0) >= 90;

  if (zh) {
    const sets = {
      coffee: [
        ["guest", "\u8fd9\u676f\u5496\u5561\u95fb\u8d77\u6765\u5f88\u9999"],
        ["host", "\u5750\u4e00\u4f1a\u5427\uff0c\u6162\u6162\u559d"],
        ["guest", "\u611f\u89c9\u601d\u8def\u53c8\u4eae\u4e86\u4e00\u70b9"],
        ["host", "\u90a3\u5c31\u5148\u628a\u4eca\u5929\u8fc7\u6210\u5c0f\u5047\u671f"],
      ],
      play: [
        ["guest", "\u8fd9\u4e00\u5c40\u8f6e\u5230\u6211\u5148\u8bd5"],
        ["host", "\u597d\uff0c\u6211\u770b\u770b\u4f60\u7684\u64cd\u4f5c"],
        ["guest", "\u54ce\uff0c\u5dee\u4e00\u70b9\u5c31\u8fc7\u4e86"],
        ["host", "\u518d\u6765\u4e00\u5c40\uff0c\u8fd9\u6b21\u5f88\u6709\u620f"],
      ],
      music: [
        ["guest", "\u5531\u7247\u4e00\u8f6c\uff0c\u623f\u95f4\u90fd\u6162\u4e0b\u6765\u4e86"],
        ["host", "\u8ddf\u7740\u8fd9\u4e00\u6bb5\u62cd\u5b50\u5c31\u597d"],
        ["guest", "\u6211\u5df2\u7ecf\u627e\u5230\u6b65\u5b50\u4e86"],
        ["host", highAffinity ? "\u90a3\u518d\u966a\u6211\u8df3\u4e00\u5c0f\u6bb5" : "\u522b\u6025\uff0c\u8fd9\u91cc\u5f88\u5bbd\u655e"],
      ],
      relax: [
        ["guest", "\u8fd9\u91cc\u5750\u7740\u5f88\u5b89\u9759"],
        ["host", "\u4eca\u5929\u53ef\u4ee5\u6162\u4e00\u70b9"],
        ["guest", "\u90a3\u6211\u5c31\u4e0d\u6025\u7740\u56de\u53bb\u4e86"],
        ["host", "\u597d\uff0c\u591a\u7559\u4e00\u4f1a\u513f"],
      ],
      admire: [
        ["guest", "\u4f60\u8fd9\u4e2a\u5e03\u7f6e\u5f88\u6709\u610f\u601d"],
        ["host", "\u6709\u4e9b\u662f\u6162\u6162\u6536\u96c6\u6765\u7684"],
        ["guest", "\u4e0b\u6b21\u4e5f\u5e26\u6211\u770b\u770b\u65b0\u7684"],
        ["host", "\u5f53\u7136\uff0c\u6211\u4f1a\u7ed9\u4f60\u7559\u4e2a\u597d\u4f4d\u7f6e"],
      ],
      wander: [
        ["guest", "\u6211\u53ef\u4ee5\u5230\u5904\u770b\u770b\u5417"],
        ["host", "\u5f53\u7136\uff0c\u522b\u649e\u5230\u684c\u89d2\u5c31\u597d"],
        ["guest", "\u8fd9\u8fb9\u597d\u50cf\u6709\u4e2a\u5c0f\u89d2\u843d"],
        ["host", "\u90a3\u662f\u6211\u6700\u559c\u6b22\u7684\u89d2\u843d"],
      ],
      interact: [
        ["guest", `${hostName}\uff0c\u6700\u8fd1\u8fc7\u5f97\u600e\u4e48\u6837`],
        ["host", `\u8fd8\u4e0d\u9519\uff0c${guestName}\u6765\u4e86\u5c31\u66f4\u70ed\u95f9\u4e00\u70b9`],
        ["guest", "\u90a3\u6211\u5c31\u591a\u5750\u4e00\u4f1a\u513f"],
        ["host", "\u6b22\u8fce\uff0c\u4eca\u5929\u623f\u95f4\u6b63\u597d\u5f88\u8212\u670d"],
      ],
    };
    return (sets[activity] ?? sets.interact).map(([speaker, text], index) => ({
      speaker,
      text,
      expression: index % 2 === 0 ? "happy" : "calm",
      durationMs: 2300,
    }));
  }

  const sets = {
    coffee: [
      ["guest", "This coffee smells tiny and perfect"],
      ["host", "Stay a minute and sip slowly"],
      ["guest", "I think my ideas woke up"],
      ["host", "Good, then today can move softly"],
    ],
    play: [
      ["guest", "I want the first round"],
      ["host", "Deal, show me your best move"],
      ["guest", "So close, I almost had it"],
      ["host", "One more round, that was good"],
    ],
    music: [
      ["guest", "The record makes the room slower"],
      ["host", "Follow this little beat"],
      ["guest", "I found the step now"],
      ["host", highAffinity ? "Then stay for one more dance" : "Nice, there is room here"],
    ],
    relax: [
      ["guest", "This spot feels quiet"],
      ["host", "We can take today slowly"],
      ["guest", "Then I will stay a little longer"],
      ["host", "Good, no hurry here"],
    ],
    admire: [
      ["guest", "Your room has a good shape"],
      ["host", "I collected it piece by piece"],
      ["guest", "Show me the new things next time"],
      ["host", "Of course, I will save you a good view"],
    ],
    wander: [
      ["guest", "Can I look around"],
      ["host", "Of course, mind the table corner"],
      ["guest", "There is a small corner over here"],
      ["host", "That is my favorite one"],
    ],
    interact: [
      ["guest", `${hostName}, how have you been`],
      ["host", `Pretty good. It is warmer with ${guestName} here`],
      ["guest", "Then I will sit for a while"],
      ["host", "Please do, the room is cozy today"],
    ],
  };

  return (sets[activity] ?? sets.interact).map(([speaker, text], index) => ({
    speaker,
    text,
    expression: index % 2 === 0 ? "happy" : "calm",
    durationMs: 2300,
  }));
};

const heuristicDialogue = (payload) => ({
  lines: heuristicLines(payload),
  summary: isZh(payload)
    ? "\u4e24\u4e2a\u89d2\u8272\u8fdb\u884c\u4e86\u4e00\u6b21\u8f7b\u677e\u7684\u4e32\u95e8\u5bf9\u8bdd\u3002"
    : "The two companions shared a gentle room visit conversation.",
  relationshipDelta: 1,
});

const normalizeLine = (line, index) => {
  const speaker = speakers.includes(line?.speaker)
    ? line.speaker
    : index % 2 === 0
      ? "guest"
      : "host";
  const text = compactText(line?.text, 56);
  if (!text) return null;
  const durationMs = Math.round(Number(line?.durationMs));
  return {
    speaker,
    text,
    expression: expressions.includes(line?.expression) ? line.expression : "happy",
    durationMs:
      Number.isFinite(durationMs) && durationMs >= 1600 && durationMs <= 3200
        ? durationMs
        : 2300,
  };
};

const normalizeDialogue = (raw, payload, source) => {
  const fallback = heuristicDialogue(payload);
  const lines = Array.isArray(raw?.lines)
    ? raw.lines.map(normalizeLine).filter(Boolean).slice(0, 6)
    : [];
  const normalizedLines = lines.length >= 2 ? lines : fallback.lines;
  return {
    lines: normalizedLines,
    summary: compactText(raw?.summary || fallback.summary, 160),
    relationshipDelta:
      Number.isFinite(Number(raw?.relationshipDelta))
        ? Math.max(0, Math.min(6, Math.round(Number(raw.relationshipDelta))))
        : fallback.relationshipDelta,
    source,
    generatedAt: new Date().toISOString(),
  };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const payload = await readJsonFile(options.payloadFile);
  const prompt = promptForPayload(payload);
  let raw;
  let source = "llm";

  if (options.provider === "claude-code") {
    raw = await callClaudeCode(prompt);
  } else if (options.provider === "codex") {
    raw = await callCodex(prompt);
  } else if (options.provider === "opencode") {
    raw = await callOpencode(prompt);
  } else if (options.provider === "none") {
    raw = heuristicDialogue(payload);
    source = "heuristic";
  } else {
    throw new Error(`Unsupported provider: ${options.provider}`);
  }

  console.log(JSON.stringify(normalizeDialogue(raw, payload, source), null, 2));
};

main().catch(async (error) => {
  try {
    const options = parseArgs(process.argv.slice(2));
    const payload = options.payloadFile ? await readJsonFile(options.payloadFile) : {};
    console.log(JSON.stringify(normalizeDialogue(heuristicDialogue(payload), payload, "heuristic"), null, 2));
  } catch {
    console.log(JSON.stringify(normalizeDialogue(heuristicDialogue({}), {}, "heuristic"), null, 2));
  }
  console.warn(`[aivatar-social-dialogue-worker] ${error instanceof Error ? error.message : String(error)}`);
});
