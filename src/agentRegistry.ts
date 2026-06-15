import type { CodexStatusMessage } from "./types";

export type KnownAgentId = "codex" | "claude-code" | "opencode";
export type LauncherAgentId = KnownAgentId;

export interface AgentDefinition {
  id: KnownAgentId;
  label: string;
  shortLabel: string;
  command: string;
  rewardEligible: boolean;
  terminalBubble: boolean;
  launcherEnabled: boolean;
}

export const AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    id: "codex",
    label: "Codex",
    shortLabel: "Codex",
    command: "codex",
    rewardEligible: true,
    terminalBubble: true,
    launcherEnabled: true,
  },
  {
    id: "claude-code",
    label: "Claude Code",
    shortLabel: "CC",
    command: "claude",
    rewardEligible: true,
    terminalBubble: true,
    launcherEnabled: true,
  },
  {
    id: "opencode",
    label: "opencode",
    shortLabel: "OC",
    command: "opencode",
    rewardEligible: true,
    terminalBubble: true,
    launcherEnabled: true,
  },
];

export const agentDefinitionForId = (agent?: string) =>
  AGENT_DEFINITIONS.find((definition) => definition.id === agent);

export const agentDisplayName = (status: Pick<CodexStatusMessage, "agent">) =>
  agentDefinitionForId(status.agent)?.label ?? status.agent?.trim() ?? "agent";

export const isRewardAgent = (status: Pick<CodexStatusMessage, "agent">) =>
  Boolean(agentDefinitionForId(status.agent)?.rewardEligible);

export const isTerminalBubbleAgent = (
  status: Pick<CodexStatusMessage, "agent">,
) => Boolean(agentDefinitionForId(status.agent)?.terminalBubble);

export const agentSourceBadge = (agent?: string) =>
  agentDefinitionForId(agent)?.shortLabel ?? null;

export const agentSourceClassName = (agent?: string) =>
  agentDefinitionForId(agent) ? `agent-${agent}` : "";

export const launcherAgentDefinitions = () =>
  AGENT_DEFINITIONS.filter((definition) => definition.launcherEnabled);
