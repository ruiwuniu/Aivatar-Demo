import type {
  AivatarLearningCandidateMetadata,
  AivatarLearningDiagnostic,
  AivatarLearningRecommendations,
  AivatarMemory,
  CodexStatusMessage,
  IdleBubbleLanguagePreference,
} from "../types";
import { normalizeSocialBubbleCandidate, socialBubbleSignature } from "./roomVisits";

export const LEARNING_CANDIDATE_LIMIT = 48;
export const APPLIED_LEARNING_ID_LIMIT = 256;
const EPOCH = "1970-01-01T00:00:00.000Z";
const providers = ["codex", "claude-code", "opencode", "codebuddy"] as const;
const reasons = ["unavailable", "authentication", "timeout", "invalid-output", "empty-candidates", "incompatible-client", "invalid-schema", "provider-error"] as const;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const identifier = (value: unknown) => typeof value === "string" && value.trim()
  ? value.trim().slice(0, 256) : undefined;
const timestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : EPOCH;
const phrase = (value: unknown) => typeof value === "string"
  ? Array.from(value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ")).slice(0, 28).join("") : "";

export interface IdleLearningCandidateOption {
  phrase: string;
  source: "memory" | "session" | "llm";
  agent?: string;
  timestamp?: string;
}

const compareCandidates = (
  left: { source: "memory" | "session" | "llm"; timestamp?: string },
  right: { source: "memory" | "session" | "llm"; timestamp?: string },
) => {
  const priority = { memory: 0, session: 1, llm: 2 };
  return priority[right.source] - priority[left.source]
    || Date.parse(timestamp(right.timestamp)) - Date.parse(timestamp(left.timestamp));
};

const uniqueSorted = <T extends { source: "memory" | "session" | "llm"; timestamp?: string }>(
  values: T[], key: (value: T) => string,
) => {
  const seen = new Set<string>();
  return values.slice().sort(compareCandidates).filter((value) => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

export const learningCandidateMatchesLanguage = (
  text: string, preference: IdleBubbleLanguagePreference, locale: string,
) => {
  const language = preference === "auto" ? (locale.startsWith("zh") ? "zh" : "en") : preference;
  return language === "mixed" || (language === "zh") === /[\u3400-\u9fff]/u.test(text);
};

export const selectIdleLearningCandidates = (
  values: IdleLearningCandidateOption[],
  accepted: string[],
  preference: IdleBubbleLanguagePreference,
  locale: string,
  limit = 6,
) => {
  const unique = uniqueSorted(values.map((value) => ({ ...value, phrase: phrase(value.phrase) }))
    .filter((value) => value.phrase.length >= 2 && !accepted.includes(value.phrase)), (value) => value.phrase);
  const visible = unique.filter((value) => learningCandidateMatchesLanguage(value.phrase, preference, locale));
  return { candidates: visible.slice(0, limit), hiddenByLanguage: unique.length - visible.length };
};

const metadata = (value: unknown): AivatarLearningCandidateMetadata | undefined => {
  if (!record(value) || value.privacyRisk === "high" || !["llm", "session"].includes(String(value.source))) return;
  return {
    source: value.source as "llm" | "session",
    agent: identifier(value.agent), sessionId: identifier(value.sessionId), learningId: identifier(value.learningId),
    timestamp: timestamp(value.timestamp), privacyRisk: value.privacyRisk === "medium" ? "medium" : "low",
  };
};

export const normalizeLearningDiagnostic = (value: unknown): AivatarLearningDiagnostic | undefined => {
  if (!record(value) || !providers.includes(value.provider as typeof providers[number])
    || !["success", "fallback"].includes(String(value.status))
    || timestamp(value.timestamp) === EPOCH) return;
  const status = value.status as AivatarLearningDiagnostic["status"];
  return {
    provider: value.provider as AivatarLearningDiagnostic["provider"], status,
    timestamp: timestamp(value.timestamp),
    ...(status === "fallback" ? {
      reason: reasons.includes(value.reason as typeof reasons[number])
        ? value.reason as AivatarLearningDiagnostic["reason"] : "provider-error" as const,
    } : {}),
  };
};

// Only bounded, display-safe fields enter the save. No prompts, summaries,
// raw provider errors or full status messages are retained here.
export const normalizeLearningRecommendations = (
  value?: unknown, memory?: AivatarMemory,
): AivatarLearningRecommendations => {
  const input = record(value) ? value : {};
  const acceptedIdle = memory?.preferences.idleBubblePhrases ?? [];
  const socialSet = memory?.preferences.socialBubbles;
  const acceptedSocial = new Set([...(socialSet?.active ?? []), ...(socialSet?.responses ?? [])]
    .flatMap((value) => {
      const candidate = normalizeSocialBubbleCandidate(value);
      return candidate ? [socialBubbleSignature(candidate)] : [];
    }));
  const idleCandidates = list(input.idleCandidates).flatMap((item) => {
    const meta = metadata(item);
    const text = record(item) ? phrase(item.phrase) : "";
    return meta && text.length >= 2 && !acceptedIdle.includes(text) ? [{ ...meta, phrase: text }] : [];
  });
  const socialCandidates = list(input.socialCandidates).flatMap((item) => {
    const meta = metadata(item);
    const candidate = record(item) && typeof item.text === "string" ? normalizeSocialBubbleCandidate(item) : undefined;
    return meta && candidate && !acceptedSocial.has(socialBubbleSignature(candidate)) ? [{ ...meta, ...candidate }] : [];
  });
  const diagnostics = list(input.diagnostics).map(normalizeLearningDiagnostic)
    .filter((value): value is AivatarLearningDiagnostic => Boolean(value))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)
      || Number(b.status === "success") - Number(a.status === "success"));
  const seenProviders = new Set<string>();
  return {
    idleCandidates: uniqueSorted(idleCandidates, (value) => value.phrase).slice(0, LEARNING_CANDIDATE_LIMIT),
    socialCandidates: uniqueSorted(socialCandidates, socialBubbleSignature).slice(0, LEARNING_CANDIDATE_LIMIT),
    diagnostics: diagnostics.filter((value) => {
      if (seenProviders.has(value.provider)) return false;
      seenProviders.add(value.provider);
      return true;
    }),
    appliedLearningIds: [...new Set([
      ...(memory?.recentEvents ?? []).filter((event) => event.type === "session_learning").map((event) => event.id),
      ...list(input.appliedLearningIds).filter((id): id is string => typeof id === "string" && id.startsWith("learning:") && id.length <= 800),
    ])].slice(-APPLIED_LEARNING_ID_LIMIT),
  };
};

export const learningReceiptId = (status: CodexStatusMessage) => status.learning
  ? `learning:${status.agent ?? "agent"}:${status.sessionId ?? "default"}:${status.learning.id}` : undefined;

// Ownership checks inspect only receipt metadata, without normalizing another
// character's full save or mixing its candidate text into the active character.
export const saveHasLearningReceipt = (value: unknown, receiptId: string): boolean => {
  if (!record(value)) return false;
  const recommendations = record(value.learningRecommendations) ? value.learningRecommendations : {};
  const memory = record(value.memory) ? value.memory : {};
  return list(recommendations.appliedLearningIds).includes(receiptId)
    || list(memory.recentEvents).some((event) => record(event)
      && event.type === "session_learning" && event.id === receiptId);
};

export const receiveLearningRecommendations = (
  value: AivatarLearningRecommendations | undefined,
  status: CodexStatusMessage,
  memory?: AivatarMemory,
): AivatarLearningRecommendations => {
  const current = normalizeLearningRecommendations(value, memory);
  const learning = status.learning;
  if (learning?.privacyRisk === "high") return current;
  const meta: AivatarLearningCandidateMetadata = {
    source: learning?.source === "llm" ? "llm" : "session",
    agent: status.agent, sessionId: status.sessionId, learningId: learning?.id,
    timestamp: timestamp(learning?.diagnostic?.timestamp ?? status.timestamp),
    privacyRisk: learning?.privacyRisk === "medium" ? "medium" : "low",
  };
  const receipt = learningReceiptId(status);
  return normalizeLearningRecommendations({
    idleCandidates: [
      ...(learning?.idleBubbleCandidates ?? []).map((phrase) => ({ ...meta, phrase })),
      ...(status.idleBubbleCandidates ?? []).map((phrase) => ({ ...meta, source: "session", phrase })),
      ...current.idleCandidates,
    ],
    socialCandidates: [
      ...(learning?.socialBubbleCandidates ?? []).map((candidate) => ({ ...meta, ...candidate })),
      ...current.socialCandidates,
    ],
    diagnostics: [...(learning?.diagnostic ? [learning.diagnostic] : []), ...current.diagnostics],
    appliedLearningIds: [...current.appliedLearningIds, ...(receipt ? [receipt] : [])],
  }, memory);
};

// Concurrent room windows contribute a union. Accepted phrases are removed
// against the merged memory so another window cannot resurrect a suggestion.
export const mergeLearningRecommendations = (
  local: AivatarLearningRecommendations | undefined,
  remote: AivatarLearningRecommendations | undefined,
  memory?: AivatarMemory,
) => {
  const ours = normalizeLearningRecommendations(local);
  const theirs = normalizeLearningRecommendations(remote);
  return normalizeLearningRecommendations({
    idleCandidates: [...ours.idleCandidates, ...theirs.idleCandidates],
    socialCandidates: [...ours.socialCandidates, ...theirs.socialCandidates],
    diagnostics: [...ours.diagnostics, ...theirs.diagnostics],
    appliedLearningIds: [...theirs.appliedLearningIds, ...ours.appliedLearningIds],
  }, memory);
};
