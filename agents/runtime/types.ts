import type { Session } from "@openai/agents";
import type { ProjectData, StyloToolSettings } from "../../types";
import type { NodeFlowFile } from "../../node-workspace/types";
import type { NodeFlowExecutionApprovalProposal } from "../../node-workspace/nodeflow/approvals";

export type AgentAttachment = {
  id: string;
  kind: "image";
  name: string;
  mimeType: string;
  url: string;
};

export type AgentUiContext = {
  supplementalContextText?: string;
  documentSelection?: {
    kind: "script";
    nodeId: string;
    documentId?: string;
    title: string;
    selectedText: string;
    range: {
      start: number;
      end: number;
    };
  };
};

export type StyloToolBudgetContext = {
  totalCalls: number;
  lookupCalls: number;
  mutationCalls: number;
  fullReadCalls: number;
  limits: {
    totalCalls: number;
    lookupCalls: number;
    mutationCalls: number;
    fullReadCalls: number;
  };
};

export type StyloRunContext = {
  runtimeMode: "browser" | "edge_full";
  toolBudget: StyloToolBudgetContext;
  uiContext?: AgentUiContext;
};

export type AgentExecutedToolCall = {
  callId: string;
  name: string;
  status: "running" | "success" | "error";
  summary?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
};

export type AgentOutputItem =
  | { kind: "text"; text: string }
  | { kind: "tool_result"; toolCall: AgentExecutedToolCall };

export type AgentTraceStage = "runtime" | "session" | "model" | "tool" | "result";
export type AgentTraceStatus = "info" | "running" | "success" | "error";
export type AgentTraceEntry = {
  id: string;
  at: number;
  stage: AgentTraceStage;
  status: AgentTraceStatus;
  title: string;
  detail?: string;
  payload?: string;
};

export type StyloRunInput = {
  projectId: string;
  sessionId: string;
  userText: string;
  attachments?: AgentAttachment[];
  enabledSkillIds?: string[];
  uiContext?: AgentUiContext;
};

export type StyloRunResult = {
  projectId: string;
  finalText: string;
  sessionId: string;
  outputItems: AgentOutputItem[];
  toolCalls: AgentExecutedToolCall[];
  updatedProjectPatch?: Partial<Pick<ProjectData, "activeFlowProjectId" | "roles" | "designAssets" | "flow" | "flowProjects">>;
  updatedProjectData?: ProjectData;
  updatedNodeFlow?: NodeFlowFile;
  updatedExecutionApprovals?: NodeFlowExecutionApprovalProposal[];
  tracing?: {
    enabled: boolean;
    traceId?: string;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
};

export interface StyloAgentRuntime {
  run(input: StyloRunInput, options?: StyloRunOptions): Promise<StyloRunResult>;
}

export type AgentRuntimeEvent = (
  | { type: "run_started"; sessionId: string; runId: string; traceId?: string; tracingEnabled?: boolean }
  | { type: "trace"; runId: string; entry: AgentTraceEntry }
  | { type: "message_delta"; runId: string; messageId?: string; delta: string; accumulatedText: string }
  | { type: "reasoning_delta"; runId: string; delta: string; accumulatedText: string }
  | { type: "reasoning_completed"; runId: string; text: string }
  | { type: "tool_called"; runId: string; call: AgentExecutedToolCall }
  | { type: "tool_completed"; runId: string; call: AgentExecutedToolCall }
  | { type: "tool_failed"; runId: string; call: AgentExecutedToolCall; error: string }
  | { type: "message_completed"; runId: string; messageId?: string; text: string; isFinal: boolean }
  | { type: "run_completed"; runId: string; result: StyloRunResult }
  | { type: "run_failed"; runId: string; error: string }
) & { sequence?: number };

export type StyloRunOptions = {
  onEvent?: (event: AgentRuntimeEvent) => void;
  signal?: AbortSignal;
};

export type StyloAgentConfig = {
  provider?: "qwen" | "openrouter" | "ark" | "deepseek";
  runtimeTarget?: "browser" | "edge";
  apiKey?: string;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  model: string;
  styloTools?: StyloToolSettings;
  tracingDisabled?: boolean;
};

export interface StyloAgentConfigProvider {
  getConfig(): Promise<StyloAgentConfig> | StyloAgentConfig;
}

export type StyloSkillManifest = {
  id: string;
  title: string;
  description: string;
  sourcePath?: string;
  activationMode?: "explicit" | "implicit";
  tags?: string[];
  preferredTools?: string[];
  disabledTools?: string[];
  implicitInvocationHints?: string[];
  version?: string;
};

export type StyloResolvedSkill = StyloSkillManifest & {
  guidanceMarkdown: string;
  overlays: string[];
  preferredTools?: string[];
  disabledTools?: string[];
  metadata?: Record<string, string>;
};

export interface StyloSkillLoader {
  listSkills(): Promise<StyloSkillManifest[]> | StyloSkillManifest[];
  getSkill(id: string): Promise<StyloResolvedSkill | null> | StyloResolvedSkill | null;
}

export type AgentSessionMessage =
  | {
      role: "user";
      text: string;
      createdAt: number;
    }
  | {
      role: "assistant";
      text: string;
      createdAt: number;
    }
  | {
      role: "reasoning";
      text: string;
      createdAt: number;
    }
  | {
      role: "tool";
      text: string;
      createdAt: number;
      toolName: string;
      toolCallId: string;
      toolStatus: "success" | "error";
      toolOutput?: unknown;
    };

export type StyloSessionRecord = {
  id: string;
  messages: AgentSessionMessage[];
  updatedAt: number;
};

export interface StyloSessionStore {
  getSession(sessionId: string): Promise<Session> | Session;
}

export interface StyloAgentTracer {
  onRunStarted(input: StyloRunInput): void;
  onToolCalled(call: AgentExecutedToolCall): void;
  onToolCompleted(call: AgentExecutedToolCall): void;
  onRunCompleted(result: StyloRunResult): void;
  onRunFailed(error: string): void;
}
