import { tool } from "@openai/agents";
import type { StyloAgentBridge } from "../bridge/styloBridge";
import type { AgentExecutedToolCall } from "../runtime/types";
import { createStyloToolInputGuardrails, createStyloToolOutputGuardrails } from "../runtime/guardrails";
import type { StyloToolBudgetPolicy } from "../runtime/toolBudget";
import {
  getStyloToolDescriptor,
  listStyloToolNames,
  type StyloToolCapability,
  type StyloToolDescriptor,
  type StyloToolName,
} from "../runtime/toolCatalog";
import {
  createDocumentToolDef,
  findDocumentsToolDef,
  readDocumentToolDef,
  updateDocumentToolDef,
} from "./documentTools";
import {
  connectFlowNodesToolDef,
  moveFlowNodeToolDef,
} from "./flowTools";
import { listProjectResourcesToolDef } from "./listProjectResources";
import { operateProjectResourceToolDef } from "./operateProjectResource";
import { operateFoundationToolDef } from "./foundationTools";
import { pingToolDef } from "./ping";
import { readProjectResourceToolDef } from "./readProjectResource";
import { searchProjectResourceToolDef } from "./searchProjectResource";
import { prepareGenerationExecutionToolDef } from "./prepareGenerationExecution";
import { cancelGenerationExecutionToolDef } from "./cancelGenerationExecution";
import { readRuntimeManualToolDef } from "./readRuntimeManual";
import { accessGithubRepositoryToolDef } from "./accessGithubRepository";
import { searchWebToolDef } from "./searchWeb";

type ToolLifecycleEvent =
  | { type: "tool_called"; call: AgentExecutedToolCall }
  | { type: "tool_completed"; call: AgentExecutedToolCall }
  | { type: "tool_failed"; call: AgentExecutedToolCall; error: string };

export const STYLO_TOOL_DEFINITIONS = [
  pingToolDef,
  findDocumentsToolDef,
  readDocumentToolDef,
  createDocumentToolDef,
  updateDocumentToolDef,
  connectFlowNodesToolDef,
  moveFlowNodeToolDef,
  operateFoundationToolDef,
  listProjectResourcesToolDef,
  readProjectResourceToolDef,
  searchProjectResourceToolDef,
  readRuntimeManualToolDef,
  accessGithubRepositoryToolDef,
  searchWebToolDef,
  operateProjectResourceToolDef,
  prepareGenerationExecutionToolDef,
  cancelGenerationExecutionToolDef,
] as const;

export type StyloToolDefinition = (typeof STYLO_TOOL_DEFINITIONS)[number];

const TOOL_DEFINITION_BY_NAME = new Map<string, StyloToolDefinition>(
  STYLO_TOOL_DEFINITIONS.map((definition) => [definition.name, definition])
);

export const findStyloToolDefinition = (toolName: string) =>
  TOOL_DEFINITION_BY_NAME.get(toolName);

export const listStyloToolDefinitions = (
  capabilities?: readonly StyloToolCapability[]
): StyloToolDefinition[] => {
  if (capabilities === undefined) return [...STYLO_TOOL_DEFINITIONS];
  const allowed = new Set<StyloToolCapability>(capabilities);
  return STYLO_TOOL_DEFINITIONS.filter((definition) =>
    allowed.has(getStyloToolDescriptor(definition.name).capability)
  );
};

export type StyloCapabilityExecutionResult = {
  name: StyloToolName;
  descriptor: StyloToolDescriptor;
  output: unknown;
  summary: string;
};

/**
 * Protocol-neutral execution boundary shared by the internal Agents SDK adapter
 * and external hosts such as MCP. It intentionally owns no LLM, message,
 * memory, token, or streaming behavior.
 */
export const executeStyloCapability = async ({
  toolName,
  input,
  bridge,
  allowedCapabilities,
}: {
  toolName: string;
  input: unknown;
  bridge: StyloAgentBridge;
  allowedCapabilities?: readonly StyloToolCapability[];
}): Promise<StyloCapabilityExecutionResult> => {
  const definition = findStyloToolDefinition(toolName);
  if (!definition) throw new Error(`Unknown Stylo tool: ${toolName}`);
  const descriptor = getStyloToolDescriptor(toolName);
  if (
    allowedCapabilities !== undefined &&
    !allowedCapabilities.includes(descriptor.capability)
  ) {
    throw new Error(
      `Stylo capability ${descriptor.capability} is not available to this Agent host.`
    );
  }
  const output = await definition.execute(input as never, bridge);
  return {
    name: definition.name as StyloToolName,
    descriptor,
    output,
    summary: definition.summarize(output as never),
  };
};

const LEGACY_DISABLED_TOOL_NAMES = new Set([
  "get_episode_script",
  "get_scene_script",
  "edit_script_resource",
  "read_project_data",
  "search_script_data",
  "upsert_character",
  "upsert_location",
]);

const assertNoLegacyTools = () => {
  const legacyTool = STYLO_TOOL_DEFINITIONS.find((toolDef) => LEGACY_DISABLED_TOOL_NAMES.has(toolDef.name));
  if (legacyTool) {
    throw new Error(`Legacy Stylo tool must not be registered in TOOL_DEFS: ${legacyTool.name}`);
  }
};

assertNoLegacyTools();

const registeredNames = new Set(STYLO_TOOL_DEFINITIONS.map((toolDef) => toolDef.name));
const catalogNames = new Set<string>(listStyloToolNames());
if (registeredNames.size !== catalogNames.size || [...registeredNames].some((name) => !catalogNames.has(name))) {
  throw new Error("Stylo tool definitions and tool catalog are out of sync");
}

const stableSerialize = (value: unknown): string => {
  if (value == null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(",")}}`;
};

const toToolArgs = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const clipToolOutputText = (value: string, limit = 1600) => {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}...`;
};

const compactToolOutputForEvents = (output: unknown) => {
  if (output == null) return output;
  if (typeof output === "string") return clipToolOutputText(output);
  if (typeof output !== "object") return output;
  const record = output as Record<string, unknown>;
  if (typeof record.summary === "string") {
    return {
      ...record,
      summary: clipToolOutputText(record.summary, 800),
    };
  }
  if (typeof record.target === "string" && typeof record.action === "string") {
    return {
      target: record.target,
      action: record.action,
      skipped: record.skipped,
      recoverable: record.recoverable,
      reason: record.reason,
      error: record.error,
      error_type: record.error_type,
      guidance: record.guidance,
      tool_name: record.tool_name,
      updated: record.updated,
      item: record.item,
      summary: record.summary,
      budget: record.budget,
    };
  }
  const json = JSON.stringify(output);
  if (json.length <= 1800) return output;
  return {
    target: typeof record.target === "string" ? record.target : "tool",
    truncated: true,
    summary: clipToolOutputText(json, 1600),
  };
};

const getToolErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && typeof (error as any).message === "string") {
    return (error as any).message;
  }
  return String(error || "Tool execution failed");
};

const getToolErrorType = (error: unknown) => {
  if (error instanceof Error && error.name) return error.name;
  if (error && typeof error === "object" && typeof (error as any).name === "string") {
    return (error as any).name;
  }
  return "ToolExecutionError";
};

const isAbortLikeToolError = (error: unknown) => {
  const name = getToolErrorType(error);
  const message = getToolErrorMessage(error);
  return name === "AbortError" || /\b(abort|aborted|cancelled|canceled)\b/i.test(message);
};

const createRecoverableToolErrorOutput = (toolName: string, error: unknown) => {
  const errorMessage = getToolErrorMessage(error);
  return {
    target: "tool_error",
    action: "recoverable_error",
    recoverable: true,
    tool_name: toolName,
    error: errorMessage,
    error_type: getToolErrorType(error),
    guidance:
      "The tool failed without a durable project change. Re-read state, adjust arguments, or explain the blocker instead of repeating the same call.",
    summary: `Tool failed: ${clipToolOutputText(errorMessage, 500)}`,
  };
};

export const createStyloTools = ({
  bridge,
  emitEvent,
  disabledTools = [],
  toolBudget,
}: {
  bridge: StyloAgentBridge;
  emitEvent?: (event: ToolLifecycleEvent) => void;
  disabledTools?: string[];
  toolBudget?: StyloToolBudgetPolicy;
}) => {
  const disabled = new Set(disabledTools);
  const lookupCache = new Map<string, { output: unknown; summary: string }>();

  return STYLO_TOOL_DEFINITIONS.filter((toolDef) => !disabled.has(toolDef.name)).map((toolDef) =>
    tool({
      name: toolDef.name,
      description: toolDef.description,
      parameters: toolDef.parameters as any,
      inputGuardrails: createStyloToolInputGuardrails(toolDef.name, bridge),
      outputGuardrails: createStyloToolOutputGuardrails(toolDef.name),
      errorFunction: (_context, error) => {
        if (isAbortLikeToolError(error)) throw error;
        return JSON.stringify(createRecoverableToolErrorOutput(toolDef.name, error));
      },
      execute: async (input) => {
        const callId = `${toolDef.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const runningCall: AgentExecutedToolCall = {
          callId,
          name: toolDef.name,
          status: "running",
          input,
        };
        emitEvent?.({ type: "tool_called", call: runningCall });
        try {
          const descriptor = getStyloToolDescriptor(toolDef.name);
          const shouldCache = descriptor.cacheWithinRun;
          const lookupSignature = shouldCache ? `${toolDef.name}:${stableSerialize(input)}` : "";

          if (shouldCache && lookupCache.has(lookupSignature)) {
            const cached = lookupCache.get(lookupSignature)!;
            const completedCall: AgentExecutedToolCall = {
              ...runningCall,
              status: "success",
              output: compactToolOutputForEvents(cached.output),
              summary: `${cached.summary}（复用本轮已有结果）`,
            };
            emitEvent?.({ type: "tool_completed", call: completedCall });
            return cached.output;
          }

          const budgetDecision = toolBudget?.reserve(toolDef.name, toToolArgs(input));
          if (budgetDecision?.allowed === false) {
            const output = {
              target: "tool_budget",
              action: "skip",
              skipped: true,
              tool_name: toolDef.name,
              reason: budgetDecision.reason,
              budget: budgetDecision.snapshot,
            };
            const completedCall: AgentExecutedToolCall = {
              ...runningCall,
              status: "success",
              output: compactToolOutputForEvents(output),
              summary: `Tool skipped: ${budgetDecision.reason}`,
            };
            emitEvent?.({ type: "tool_completed", call: completedCall });
            return output;
          }

          const execution = await executeStyloCapability({
            toolName: toolDef.name,
            input,
            bridge,
          });
          const { output, summary } = execution;
          if (shouldCache) {
            lookupCache.set(lookupSignature, { output, summary });
          }
          if (descriptor.category === "mutation" || descriptor.category === "approval") {
            lookupCache.clear();
          }
          const completedCall: AgentExecutedToolCall = {
            ...runningCall,
            status: "success",
            output: compactToolOutputForEvents(output),
            summary,
          };
          emitEvent?.({ type: "tool_completed", call: completedCall });
          return output;
        } catch (error: any) {
          if (isAbortLikeToolError(error)) throw error;
          const output = createRecoverableToolErrorOutput(toolDef.name, error);
          const failedCall: AgentExecutedToolCall = {
            ...runningCall,
            status: "error",
            error: error?.message || "工具执行失败",
          };
          failedCall.error = output.error;
          failedCall.output = compactToolOutputForEvents(output);
          failedCall.summary = output.summary;
          emitEvent?.({
            type: "tool_failed",
            call: failedCall,
            error: failedCall.error || "工具执行失败",
          });
          return output;
        }
      },
    })
  );
};
