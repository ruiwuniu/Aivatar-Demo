#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureUsageBaseline,
  findRolloutPath,
  getContextUsage,
  getUsageDelta,
  toAivatarUsage,
} from "./codex-usage.mjs";

const endpoint =
  process.env.AIVATAR_HTTP_ENDPOINT ?? "http://127.0.0.1:38988/agent-status";
const learningEnabled = /^(1|true|yes|on)$/i.test(
  process.env.AIVATAR_LEARNING_ENABLED ?? "",
);
const learningProvider = process.env.AIVATAR_LEARNING_PROVIDER ?? "codex";
const learningScript = process.env.AIVATAR_LEARNING_SCRIPT ?? "";
const avatarStateFile =
  process.env.AIVATAR_AVATAR_STATE_FILE ??
  process.env.AIVATAR_AVATAR_STATE_PATH ??
  join(tmpdir(), "aivatar-avatar-state.json");
const learningContextDir = join(tmpdir(), "aivatar-learning-context");

const liveStatuses = new Set(["thinking", "executing", "waiting_for_user"]);
const terminalStatuses = new Set(["complete", "error", "idle"]);

const parseArgs = (argv) => {
  const envSessionId =
    process.env.AIVATAR_SESSION_ID ??
    process.env.CODEX_THREAD_ID ??
    process.env.CODEX_SESSION_ID ??
    "";
  const options = {
    agent: process.env.AIVATAR_AGENT ?? "codex",
    sessionId: envSessionId,
    hasExplicitSessionId: Boolean(envSessionId),
    intervalMs: Number(process.env.AIVATAR_WATCH_INTERVAL_MS ?? 500),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--agent") {
      options.agent = argv[index + 1] ?? options.agent;
      index += 1;
      continue;
    }
    if (value === "--session" || value === "--session-id") {
      options.sessionId = argv[index + 1] ?? options.sessionId;
      options.hasExplicitSessionId = Boolean(options.sessionId);
      index += 1;
      continue;
    }
    if (value === "--interval-ms") {
      const intervalMs = Number(argv[index + 1]);
      options.intervalMs = Number.isFinite(intervalMs) ? intervalMs : options.intervalMs;
      index += 1;
    }
  }

  options.intervalMs = Math.max(250, options.intervalMs);
  return options;
};

const postJson = async (url, payload) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const text = await response.text();
  return text ? JSON.parse(text) : {};
};

const textFromPayload = (payload) => {
  const text =
    payload?.message ??
    payload?.text ??
    (Array.isArray(payload?.content)
      ? payload.content
          .map((entry) => entry?.text)
          .filter(Boolean)
          .join(" ")
      : "");

  return typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "";
};

const shortText = (value, fallback) => {
  const text = value || fallback;
  return text.length > 90 ? `${text.slice(0, 87)}...` : text;
};

const safeName = (value) => String(value).replace(/[^a-zA-Z0-9_.-]/g, "_");

const sanitizeLearningText = (value, limit = 420) =>
  String(value ?? "")
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

const phraseLength = (value) => Array.from(value).length;

const maxIdleBubbleLength = 28;

const normalizeIdleBubblePhrase = (value) =>
  value.trim().replace(/\s+/g, " ");

const hasHanText = (value) => /[\u3400-\u9fff]/u.test(value);

const idleBubbleTemplates = {
  en: {
    fix: [
      "Tiny fix dance",
      "We can mend it",
      "Patch, then snacks",
      "Bug knot spotted",
      "Bug tried its best",
      "Tiny brave patch",
      "Steady hands",
      "Mend mode on",
      "Patch with patience",
      "Error met a cushion",
      "Fix sparkle queued",
      "Little repair ritual",
      "Calm patch energy",
      "Bug goes in time-out",
      "Thread untangled",
      "Repair hat on",
    ],
    reading: [
      "Reading the room",
      "Tiny clue hunt",
      "Notes in my tentacles",
      "Context tastes useful",
      "Trace, then tidy",
      "Clues line up",
      "Tea and context",
      "Reading paws first",
      "Pages know things",
      "Quiet clue mode",
      "Context lantern lit",
      "One more breadcrumb",
      "Facts are stretching",
      "Scroll, sip, learn",
      "Pattern getting visible",
      "Notes stack neatly",
    ],
    waiting: [
      "Waiting politely",
      "Holding the thought",
      "Your call, captain",
      "Paused with purpose",
      "Standing by softly",
      "No rush here",
      "Ready when you are",
      "Holding the spark",
      "I can wait well",
      "Decision docked",
      "Signal when ready",
      "Tiny pause posture",
      "Permission lantern on",
      "Still but listening",
      "Waiting with tea",
      "Choice stays warm",
    ],
    polish: [
      "Less robot, more cozy",
      "This needs sparkle",
      "Softening the edges",
      "Pixel polish time",
      "Give it a wink",
      "Make it less manual",
      "Words need rhythm",
      "A softer little voice",
      "Tone wants socks",
      "Sprinkle some charm",
      "Make it hum",
      "Less log, more life",
      "Phrase needs a pulse",
      "Tiny voice tuning",
      "Smooth the sentence",
      "Cute but clear",
    ],
    success: [
      "Nice little win",
      "Done clean",
      "That landed softly",
      "Tiny victory wiggle",
      "Clean little landing",
      "Victory sparkle",
      "High five moment",
      "That one sings",
      "Shipped with a grin",
      "Win tucked away",
      "Task bowed nicely",
      "Sparkles accounted for",
      "Clean finish glow",
      "Tiny crown moment",
      "That clicked shut",
      "Good work, soft landing",
    ],
    thinking: [
      "Thinking in loops",
      "Let me squint",
      "Idea soup simmering",
      "Tracing the shape",
      "Brain doing circles",
      "Let it simmer",
      "Spark loading",
      "Tiny theory forming",
      "Thoughts are orbiting",
      "Maybe-shaped idea",
      "Logic soup bubbling",
      "Squinting responsibly",
      "Hypothesis wearing shoes",
      "Tiny gears whisper",
      "Let the idea hatch",
      "Pattern moon rising",
    ],
    cozy: [
      "Room feels warmer",
      "Cozy mode online",
      "Decor thoughts",
      "A softer corner",
      "Nest feels brighter",
      "Soft corner energy",
      "Air got sweeter",
      "Cozy thoughts bloom",
      "Lamp mood achieved",
      "Tiny home glow",
      "Blanket logic active",
      "Room hums gently",
      "Corner passed vibe check",
      "Soft pixels settling",
      "Little nest upgrade",
      "Warmth has arrived",
    ],
    daily: [
      "Tiny day rhythm",
      "Sip, then continue",
      "Small life sparkle",
      "Let the mood breathe",
      "Desk feels warm",
      "Rest counts too",
      "Tuck today away",
      "Soft minute first",
      "Slow is allowed",
      "Tiny routine magic",
      "Water break wisdom",
      "Day folded neatly",
      "Mood doing stretches",
      "Gentle pace wins",
      "A small good moment",
      "Breathe, then build",
    ],
  },
  zh: {
    fix: [
      "小修一下",
      "补丁在路上",
      "这个结能解",
      "先把它缝好",
      "抱一下再修",
      "这锅不大",
      "稳住能补",
      "小问题别跑",
      "慢慢补回来",
      "错误先坐好",
      "修复光波启动",
      "小洞缝一下",
      "先稳住手",
      "bug去面壁",
      "线头解开啦",
      "戴上修修帽",
    ],
    reading: [
      "我在翻线索",
      "上下文有味道",
      "让我再看看",
      "捡到一点线索",
      "把线捋直",
      "线索排排坐",
      "慢慢翻页",
      "我闻到重点了",
      "资料会说话",
      "安静找线索",
      "点亮上下文",
      "再捡一颗面包屑",
      "规律露头了",
      "边喝边看",
      "重点快显形",
      "笔记叠整齐",
    ],
    waiting: [
      "乖乖等你",
      "先抱住想法",
      "等你点头",
      "暂停也算前进",
      "我先不乱动",
      "收到再出手",
      "安静待命中",
      "把想法捧好",
      "我很会等",
      "决定先靠岸",
      "你喊我就来",
      "暂停姿势摆好",
      "许可灯亮着",
      "安静但在听",
      "边等边喝茶",
      "选择还热着",
    ],
    polish: [
      "这句有点硬",
      "换个软乎说法",
      "让它活一点",
      "加一点小灵气",
      "语气加点糖",
      "别太像说明书",
      "让它会眨眼",
      "这句要会呼吸",
      "给句子穿袜子",
      "撒一点可爱",
      "让它哼起来",
      "少点日志味",
      "这句需要心跳",
      "调一调小嗓门",
      "把句子磨圆",
      "可爱但清楚",
    ],
    success: [
      "漂亮收工",
      "小胜一口气",
      "这下顺了",
      "完成得很干净",
      "好耶收好",
      "小章鱼击掌",
      "这波很稳",
      "灵感落袋",
      "笑着发货",
      "胜利装进口袋",
      "任务乖乖鞠躬",
      "闪光已入账",
      "收尾亮亮的",
      "小皇冠时刻",
      "咔哒合上了",
      "软着陆成功",
    ],
    thinking: [
      "我转转脑袋",
      "想法在冒泡",
      "让我眯眼想想",
      "灵感快浮上来",
      "脑内转圈圈",
      "让我绕一下",
      "灵感上线中",
      "先别催泡泡",
      "想法在公转",
      "也许长出形状",
      "逻辑汤冒泡",
      "负责地眯眼",
      "假设穿鞋了",
      "小齿轮在低语",
      "让点子孵一会",
      "规律月亮升起",
    ],
    cozy: [
      "房间暖一点",
      "今天想软软的",
      "这里可以更舒服",
      "小角落发光了",
      "窝里亮一点",
      "今日适合发呆",
      "把角落养软",
      "空气变甜了",
      "台灯心情达成",
      "小窝发光中",
      "毯子逻辑启动",
      "房间轻轻哼歌",
      "角落通过氛围检查",
      "软像素落座",
      "小窝升级啦",
      "暖意抵达",
    ],
    daily: [
      "今天慢慢来",
      "先喝口水",
      "小日子发光",
      "心情晾一晾",
      "桌边有点暖",
      "休息也算数",
      "把今天收好",
      "软软过一会",
      "慢一点也可以",
      "日常有魔法",
      "喝水很有智慧",
      "把今天叠整齐",
      "心情伸个懒腰",
      "温柔节奏胜利",
      "一个小好时刻",
      "先呼吸再开工",
    ],
  },
};

const detectIdleBubbleTags = (value) => {
  const tags = [];

  if (/\b(fix|bug|error|fail|broken|patch|repair|debug)\b/i.test(value) || /修|错|坏|补丁|调试|失败/.test(value)) {
    tags.push("fix");
  }
  if (/\b(read|inspect|search|context|docs?|file|files)\b/i.test(value) || /读|看|搜索|上下文|文件|说明/.test(value)) {
    tags.push("reading");
  }
  if (/\b(wait|approve|confirm|permission|blocked)\b/i.test(value) || /等|确认|批准|同意|暂停/.test(value)) {
    tags.push("waiting");
  }
  if (/\b(polish|design|copy|text|word|phrase|bubble|cozy|soft|lively)\b/i.test(value) || /打磨|设计|文本|句|气泡|生动|软|舒服/.test(value)) {
    tags.push("polish");
  }
  if (/\b(done|complete|success|finished|ready|works)\b/i.test(value) || /完成|好了|成功|收工|顺了/.test(value)) {
    tags.push("success");
  }
  if (/\b(think|maybe|idea|plan|wonder|explore)\b/i.test(value) || /想|灵感|也许|方案|探索/.test(value)) {
    tags.push("thinking");
  }
  if (/\b(room|pet|avatar|decor|coffee|sleep|snack)\b/i.test(value) || /房间|宠物|头像|装饰|咖啡|睡|零食/.test(value)) {
    tags.push("cozy");
  }
  if (/\b(today|daily|life|mood|rest|break|sip|tea|water|slow|rhythm)\b/i.test(value) || /今天|日常|生活|心情|休息|喝|水|茶|慢慢|节奏/.test(value)) {
    tags.push("daily");
  }

  return tags.length > 0 ? tags : ["thinking"];
};

const sessionLanguageOrder = (value) =>
  hasHanText(value) ? ["zh", "en"] : ["en", "zh"];

const generatedIdleBubbleCandidates = (text) => {
  const tags = detectIdleBubbleTags(text);
  const languages = sessionLanguageOrder(text);
  const candidates = [];

  for (const language of languages) {
    for (const tag of tags) {
      for (const phrase of idleBubbleTemplates[language][tag] ?? []) {
        if (!candidates.includes(phrase)) candidates.push(phrase);
      }
    }
  }

  return candidates.slice(0, 8);
};

const looksLikeNoise = (value) => {
  const text = value.trim();
  if (text.length < 2) return true;
  if (/^(```|~~~|[-*]\s|\d+\.\s)/.test(text)) return true;
  if (/^#{1,6}\s/.test(text)) return true;
  if (/https?:\/\//i.test(text)) return true;
  if (/\[[^\]]+\]\([^)]+\)/.test(text)) return true;
  if (/[\\/][\w.-]+[\\/]/.test(text)) return true;
  if (/\b(npm|node|git|cargo|powershell|cmd\.exe|apply_patch|localhost)\b/i.test(text)) return true;
  if (/\b(const|let|function|return|import|export|type|interface)\b/.test(text)) return true;
  if (/[{}()[\];=<>]{3,}/.test(text)) return true;
  if (/^[\w.-]+\.(tsx?|jsx?|mjs|json|toml|rs|css|md)(:\d+)?$/i.test(text)) return true;
  return false;
};

const looksLikeConversationalSnippet = (value) => {
  if (looksLikeNoise(value)) return false;
  if (/[?!。！？~]$/.test(value)) return true;
  if (/\b(nice|tiny|cozy|soft|steady|oops|hmm|yay|almost)\b/i.test(value)) return true;
  if (/[呀呢吧哦啦嘛哇诶耶～]/u.test(value)) return true;
  if (
    hasHanText(value) &&
    phraseLength(value) <= 12 &&
    !/请|需要|修改|调整|实现|文件|代码|项目|候选|session/i.test(value)
  ) {
    return true;
  }
  return false;
};

const legacyCandidateScore = (value) => {
  let score = 0;
  if (/[?!?！。吧呢呀哦啦了]$/.test(value)) score += 2;
  if (/\b(done|fixed|checking|ready|steady|nice|tiny|clean|almost)\b/i.test(value)) score += 2;
  if (/[稳好看修慢急懂醒乖等看想试]/.test(value)) score += 2;
  if (phraseLength(value) <= 16) score += 1;
  return score;
};

const candidateScore = (value) => {
  let score = 0;
  if (/[?!。！？吧呢呀哦啦了~]$/.test(value)) score += 2;
  if (/\b(done|fixed|checking|ready|steady|nice|tiny|clean|almost)\b/i.test(value)) score += 2;
  if (/[稳好看修慢急懂醒乖等看想试软活暖]/.test(value)) score += 2;
  if (phraseLength(value) <= 16) score += 1;
  return score;
};

const extractIdleBubbleCandidates = (text) => {
  if (!text) return [];
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];

  const generated = generatedIdleBubbleCandidates(cleaned);
  const splitReady = cleaned
    .replace(/([。！？；])/gu, "$1 ")
    .replace(/，/gu, ", ");
  const snippets = splitReady
    .split(/(?<=[.!?。！？；;])\s+|[\r\n]+|[，,]\s+/u)
    .map(normalizeIdleBubblePhrase)
    .filter((phrase) => {
      const length = phraseLength(phrase);
      return (
        length >= 2 &&
        length <= maxIdleBubbleLength &&
        looksLikeConversationalSnippet(phrase)
      );
    });

  return [
    ...generated,
    ...snippets.sort((left, right) => candidateScore(right) - candidateScore(left)),
  ]
    .filter((phrase, index, candidates) => candidates.indexOf(phrase) === index)
    .slice(0, 6);
};

const parseJsonLines = (chunk) => {
  const records = [];
  const lines = chunk.split(/\r?\n/);
  const remainder = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // Rollout files are append-only. Ignore a malformed partial line.
    }
  }

  return { records, remainder };
};

const options = parseArgs(process.argv.slice(2));

if (!options.hasExplicitSessionId) {
  console.error(
    "[aivatar-watch] Refusing to start without a session id. Use aivatar-connect, or pass --session SESSION_ID.",
  );
  process.exit(1);
}

let stopped = false;
let warnedBridge = false;
let lastStatusKey = "";
let lastLiveStatus = null;
let rolloutPath = null;
let offset = 0;
let pending = "";
let nextLocateAt = 0;
let idleBubbleCandidates = [];
let conversationDigestEntries = [];
let lastLearningKey = "";

const isFinalPhase = (phase) => phase === "final" || phase === "final_answer";

const rememberIdleBubbleCandidates = (text) => {
  const nextCandidates = extractIdleBubbleCandidates(text);
  if (nextCandidates.length === 0) return;
  const seen = new Set(idleBubbleCandidates);
  idleBubbleCandidates = [
    ...nextCandidates.filter((candidate) => !seen.has(candidate)),
    ...idleBubbleCandidates,
  ].slice(0, 12);
};

const rememberConversationDigest = (role, text) => {
  const clean = sanitizeLearningText(text);
  if (!clean) return;
  conversationDigestEntries.push({ role, text: clean });
  conversationDigestEntries = conversationDigestEntries.slice(-12);
};

const writeLearningContext = async () => {
  if (conversationDigestEntries.length === 0) return null;
  await fs.mkdir(learningContextDir, { recursive: true });
  const path = join(
    learningContextDir,
    `codex-${safeName(options.sessionId)}-${Date.now()}.txt`,
  );
  const content = conversationDigestEntries
    .map((entry) => `${entry.role}: ${entry.text}`)
    .join("\n");
  await fs.writeFile(path, content, "utf8");
  return path;
};

const spawnLearningWorker = async (status, summary) => {
  if (!learningEnabled || !learningScript || conversationDigestEntries.length === 0) {
    return;
  }

  const learningKey = `${status}:${summary}:${
    conversationDigestEntries.at(-1)?.text ?? ""
  }`;
  if (learningKey === lastLearningKey) return;
  lastLearningKey = learningKey;

  const contextPath = await writeLearningContext();
  if (!contextPath) return;

  const child = spawn(
    process.execPath,
    [
      learningScript,
      "--provider",
      learningProvider,
      "--agent",
      options.agent,
      "--session",
      options.sessionId,
      "--status",
      status,
      "--summary",
      summary,
      "--context-file",
      contextPath,
      "--avatar-state-file",
      avatarStateFile,
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        AIVATAR_AGENT: options.agent,
        AIVATAR_SESSION_ID: options.sessionId,
        AIVATAR_LEARNING_PROVIDER: learningProvider,
      },
    },
  );
  child.unref();
};

const emitStatus = async (status, message, extra = {}) => {
  const phase = extra.phase ?? status;
  const summary = shortText(message, `${options.agent} ${status.replace(/_/g, " ")}`);
  let usage = extra.usage ?? null;

  if (options.agent === "codex") {
    if (status === "complete" || status === "error") {
      usage =
        toAivatarUsage(
          await getUsageDelta(options.sessionId, { clearBaseline: true }),
        ) ?? toAivatarUsage(await getContextUsage(options.sessionId));
    } else if (
      (status === "thinking" || status === "executing") &&
      !extra.preserveBaseline
    ) {
      await ensureUsageBaseline(options.sessionId, {
        reset: status === "thinking",
        status,
      });
      if (!usage) {
        usage =
          toAivatarUsage(await getUsageDelta(options.sessionId)) ??
          toAivatarUsage(await getContextUsage(options.sessionId));
      }
    }
  }

  const statusKey = `${status}:${phase}:${summary}`;
  if (
    statusKey === lastStatusKey &&
    status !== "complete" &&
    status !== "error" &&
    !extra.force
  ) {
    return;
  }
  lastStatusKey = statusKey;

  const payload = {
    agent: options.agent,
    sessionId: options.sessionId,
    status,
    phase,
    task: summary,
    summary,
    progress:
      extra.progress ??
      (status === "complete" ? 100 : status === "idle" ? 0 : 50),
    message: summary,
    severity:
      extra.severity ??
      (status === "error" ? "error" : status === "waiting_for_user" ? "warning" : "info"),
    timestamp: new Date().toISOString(),
    ...(usage ? { usage } : {}),
    ...(idleBubbleCandidates.length > 0
      ? { idleBubbleCandidates }
      : {}),
  };

  if (liveStatuses.has(status)) {
    lastLiveStatus = {
      status,
      message: summary,
      phase,
      progress: payload.progress,
      severity: payload.severity,
    };
  } else if (terminalStatuses.has(status)) {
    lastLiveStatus = null;
  }

  try {
    await postJson(endpoint, payload);
    warnedBridge = false;
  } catch (error) {
    if (!warnedBridge) {
      warnedBridge = true;
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[aivatar-watch] Aivatar bridge unavailable: ${reason}`);
    }
  }
};

const handleRecord = async (record) => {
  const payload = record?.payload;
  if (!payload || typeof payload !== "object") return;

  if (record.type === "event_msg" && payload.type === "token_count") {
    if (options.agent !== "codex" || !lastLiveStatus) return;
    const usage =
      toAivatarUsage(await getUsageDelta(options.sessionId)) ??
      toAivatarUsage(await getContextUsage(options.sessionId));
    if (!usage?.contextTokens || !usage?.modelContextWindow) return;
    await emitStatus(lastLiveStatus.status, lastLiveStatus.message, {
      phase: lastLiveStatus.phase,
      progress: lastLiveStatus.progress,
      severity: lastLiveStatus.severity,
      usage,
      force: true,
      preserveBaseline: true,
    });
    return;
  }

  if (record.type === "event_msg" && payload.type === "user_message") {
    const text = textFromPayload(payload);
    rememberIdleBubbleCandidates(text);
    rememberConversationDigest("user", text);
    await emitStatus("thinking", shortText(text, "Reading your request"), {
      phase: "user-message",
      progress: 30,
    });
    return;
  }

  if (
    record.type === "response_item" &&
    (payload.type === "function_call" || payload.type === "custom_tool_call")
  ) {
    await emitStatus("executing", shortText(payload.name, "Using a tool"), {
      phase: "tool-use",
      progress: 55,
    });
    return;
  }

  if (
    record.type === "response_item" &&
    (payload.type === "function_call_output" ||
      payload.type === "custom_tool_call_output")
  ) {
    await emitStatus("thinking", "Reading tool results", {
      phase: "tool-result",
      progress: 65,
      preserveBaseline: true,
    });
    return;
  }

  if (
    record.type === "event_msg" &&
    payload.type === "agent_message" &&
    isFinalPhase(payload.phase)
  ) {
    const text = textFromPayload(payload);
    rememberIdleBubbleCandidates(text);
    rememberConversationDigest("assistant", text);
    const summary = shortText(text, "Task finished");
    await emitStatus("complete", summary, {
      phase: payload.phase,
      progress: 100,
    });
    void spawnLearningWorker("complete", summary).catch(() => {
      // Learning must never interrupt live status updates.
    });
  }
};

const locateRollout = async () => {
  if (Date.now() < nextLocateAt) return false;
  nextLocateAt = Date.now() + 5000;

  const found = await findRolloutPath(options.sessionId);
  if (!found) return false;

  rolloutPath = found;
  nextLocateAt = 0;
  const stat = await fs.stat(rolloutPath);
  offset = stat.size;
  pending = "";
  console.log(`[aivatar-watch] watching ${rolloutPath}`);
  return true;
};

const pollRollout = async () => {
  if (!rolloutPath) {
    await locateRollout();
    return;
  }

  let stat;
  try {
    stat = await fs.stat(rolloutPath);
  } catch {
    rolloutPath = null;
    offset = 0;
    pending = "";
    return;
  }

  if (stat.size < offset) {
    offset = stat.size;
    pending = "";
    return;
  }

  if (stat.size === offset) return;

  const handle = await fs.open(rolloutPath, "r");
  try {
    const length = stat.size - offset;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, offset);
    offset = stat.size;

    const parsed = parseJsonLines(pending + buffer.toString("utf8"));
    pending = parsed.remainder;

    for (const record of parsed.records) {
      await handleRecord(record);
    }
  } finally {
    await handle.close();
  }
};

process.on("SIGINT", () => {
  stopped = true;
  process.exit(130);
});

process.on("SIGTERM", () => {
  stopped = true;
  process.exit(143);
});

console.log(
  `[aivatar-watch] ${options.agent}/${options.sessionId} every ${options.intervalMs}ms`,
);
await locateRollout();

while (!stopped) {
  await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  await pollRollout();
}
