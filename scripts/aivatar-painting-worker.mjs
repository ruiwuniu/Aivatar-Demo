#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

const defaultTimeoutMs = Math.max(
  5000,
  Number(process.env.AIVATAR_PAINTING_TIMEOUT_MS ?? 25000),
);
const configuredCodexCommand =
  process.env.AIVATAR_CODEX_COMMAND ?? process.env.CODEX_COMMAND ?? null;
const defaultCodexCommand = process.platform === "win32" ? "codex.cmd" : "codex";
const claudeCommand = process.env.AIVATAR_CLAUDE_COMMAND ?? "claude";
const configuredOpencodeCommand =
  process.env.AIVATAR_OPENCODE_COMMAND ?? process.env.OPENCODE_COMMAND ?? null;

const archetypes = [
  "signal_tower",
  "window_city",
  "terminal_star_map",
  "desk_still_life",
  "harbor_beacon",
  "mountain_path",
  "circuit_grid",
  "mosaic_garden",
  "color_bloom",
  "lantern_room",
];

const paintingPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 2, maxLength: 42 },
    archetype: { enum: archetypes },
    mood: { type: "string", maxLength: 60 },
    paletteHint: { type: "string", maxLength: 60 },
    composition: {
      type: "object",
      additionalProperties: false,
      properties: {
        background: { type: "string", maxLength: 60 },
        subject: { type: "string", maxLength: 60 },
        foreground: { type: "string", maxLength: 60 },
        accent: { type: "string", maxLength: 60 },
      },
      required: ["background", "subject", "foreground", "accent"],
    },
    motifs: {
      type: "array",
      items: { type: "string", minLength: 2, maxLength: 32 },
      maxItems: 5,
    },
  },
  required: ["title", "archetype", "mood", "paletteHint", "composition", "motifs"],
};

const usage = `Usage:
  node scripts/aivatar-painting-worker.mjs --provider codex --payload-file payload.json

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
      process.env.AIVATAR_PAINTING_PROVIDER ??
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

const promptForPayload = (payload) => `You are Aivatar's tiny painting art director.

Aivatar will render a 24x35 pixel painting locally. Return only a compact JSON painting plan.

Privacy and content rules:
- Use only low-sensitivity information in the payload.
- Do not include file paths, source code, URLs, logs, secrets, or private identifiers.
- Do not mention trait point totals.
- The plan should be symbolic, cozy, and readable as pixel art.
- Pick an archetype from this exact list: ${archetypes.join(", ")}.
- If the dominant trait is focus, prefer variety among signal_tower, window_city, terminal_star_map, and desk_still_life.
- Let recent memories and saved bubbles influence motifs and composition.
- Keep title short, natural, and not always the same for the same trait.

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
      JSON.stringify(paintingPlanSchema),
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
  const dir = join(tmpdir(), "aivatar-painting-worker");
  await mkdir(dir, { recursive: true });
  const schemaPath = join(dir, `${runId}.schema.json`);
  const outputPath = join(dir, `${runId}.output.json`);
  await writeFile(schemaPath, JSON.stringify(paintingPlanSchema, null, 2), "utf8");
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

const hashString = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const archetypeForPayload = (payload) => {
  const trait = payload?.dominantTrait ?? "focus";
  const text = JSON.stringify(payload ?? {}).toLowerCase();
  if (/terminal|codex|agent|task|session|status/u.test(text)) return "terminal_star_map";
  if (/window|city|browser|preview|night/u.test(text)) return "window_city";
  if (/coffee|desk|table|room|item/u.test(text)) return "desk_still_life";
  if (/recover|error|steady|repair/u.test(text)) return "harbor_beacon";
  if (/explore|path|route|learn/u.test(text)) return "mountain_path";
  if (/build|test|grid|clean/u.test(text)) return "circuit_grid";
  if (/paint|color|creative|spark/u.test(text)) return "color_bloom";
  if (/warm|sleep|cozy|care/u.test(text)) return "lantern_room";
  const byTrait = {
    focus: ["signal_tower", "window_city", "terminal_star_map", "desk_still_life"],
    resilience: ["harbor_beacon", "mountain_path", "desk_still_life", "lantern_room"],
    curiosity: ["terminal_star_map", "window_city", "mountain_path", "mosaic_garden"],
    efficiency: ["circuit_grid", "terminal_star_map", "desk_still_life", "signal_tower"],
    creativity: ["color_bloom", "mosaic_garden", "terminal_star_map", "window_city"],
    warmth: ["lantern_room", "desk_still_life", "window_city", "mosaic_garden"],
  };
  const choices = byTrait[trait] ?? byTrait.focus;
  return choices[hashString(text) % choices.length];
};

const titleForArchetype = (archetype) =>
  ({
    signal_tower: "Quiet Tower",
    window_city: "Window Signal",
    terminal_star_map: "Terminal Stars",
    desk_still_life: "Desk Signal",
    harbor_beacon: "Steady Beacon",
    mountain_path: "Little Path",
    circuit_grid: "Bright Circuit",
    mosaic_garden: "Mosaic Garden",
    color_bloom: "Color Bloom",
    lantern_room: "Soft Lantern",
  })[archetype] ?? "Little Painting";

const heuristicPlan = (payload) => {
  const archetype = archetypeForPayload(payload);
  const motifs = [
    ...(Array.isArray(payload?.recentEvents)
      ? payload.recentEvents.map((event) => event?.type).filter(Boolean)
      : []),
    ...(Array.isArray(payload?.savedBubbles) ? payload.savedBubbles : []),
  ]
    .map((value) => compactText(value, 24))
    .filter(Boolean)
    .slice(0, 5);
  return {
    title: titleForArchetype(archetype),
    archetype,
    mood: compactText(payload?.dominantTrait ?? "quiet", 60),
    paletteHint: "use the avatar trait palette",
    composition: {
      background: "soft room memory",
      subject: titleForArchetype(archetype),
      foreground: "tiny symbolic objects",
      accent: "small highlight pixels",
    },
    motifs,
  };
};

const normalizePlan = (raw, payload, source) => {
  const fallback = heuristicPlan(payload);
  const archetype = archetypes.includes(raw?.archetype)
    ? raw.archetype
    : fallback.archetype;
  const motifs = Array.isArray(raw?.motifs)
    ? raw.motifs.map((motif) => compactText(motif, 32)).filter(Boolean).slice(0, 5)
    : fallback.motifs;

  return {
    title: compactText(raw?.title || fallback.title, 42),
    archetype,
    mood: compactText(raw?.mood || fallback.mood, 60),
    paletteHint: compactText(raw?.paletteHint || fallback.paletteHint, 60),
    composition: {
      background: compactText(raw?.composition?.background || fallback.composition.background, 60),
      subject: compactText(raw?.composition?.subject || fallback.composition.subject, 60),
      foreground: compactText(raw?.composition?.foreground || fallback.composition.foreground, 60),
      accent: compactText(raw?.composition?.accent || fallback.composition.accent, 60),
    },
    motifs,
    source,
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
    raw = heuristicPlan(payload);
    source = "heuristic";
  } else {
    throw new Error(`Unsupported provider: ${options.provider}`);
  }

  console.log(JSON.stringify(normalizePlan(raw, payload, source), null, 2));
};

main().catch(async (error) => {
  try {
    const options = parseArgs(process.argv.slice(2));
    const payload = await readJsonFile(options.payloadFile);
    console.warn(`[aivatar-painting-worker] ${error instanceof Error ? error.message : error}`);
    console.log(JSON.stringify(normalizePlan(heuristicPlan(payload), payload, "heuristic"), null, 2));
  } catch (fallbackError) {
    console.error(fallbackError instanceof Error ? fallbackError.message : fallbackError);
    process.exit(1);
  }
});
