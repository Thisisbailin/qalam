import type { StyloRunResult } from "../../agents/runtime/types";
import type { loadAgentProjectState } from "./_agentProjectState";
import {
  mergeAgentNodeFlowIntoProjectData,
  splitAgentScriptEditProposals,
  type createNodeFlowBridgeState,
} from "./_agentBridgeState";
import {
  applyRealtimeAgentProjectSnapshot,
  type RealtimeProjectionEnv,
} from "./_realtimeProjection";

export const commitAgentBridgeResult = async ({
  env,
  userId,
  projectId,
  idempotencyKey,
  projectState,
  bridgeState,
}: {
  env: RealtimeProjectionEnv;
  userId: string;
  projectId: string;
  idempotencyKey: string;
  projectState: Awaited<ReturnType<typeof loadAgentProjectState>>;
  bridgeState: ReturnType<typeof createNodeFlowBridgeState>;
}): Promise<Pick<StyloRunResult, "projectCommit" | "scriptEditProposals">> => {
  const splitNodeFlow = splitAgentScriptEditProposals(
    projectState.nodeFlow,
    bridgeState.getNodeFlow(),
  );
  const hasProjectMutation = bridgeState.hasUpdatedProjectData() || splitNodeFlow.hasCommittedNodeFlowMutation;
  let projectCommit: StyloRunResult["projectCommit"];

  if (hasProjectMutation) {
    const candidate = splitNodeFlow.committedNodeFlow;
    const committedNodeFlow = candidate.revision > projectState.nodeFlow.revision
      ? candidate
      : { ...candidate, revision: projectState.nodeFlow.revision + 1 };
    const nextProjectData = mergeAgentNodeFlowIntoProjectData(
      projectState.projectData,
      bridgeState.getProjectData(),
      committedNodeFlow,
      projectId,
    );
    const operationId = `agent:${idempotencyKey}`;
    const committed = await applyRealtimeAgentProjectSnapshot(env, userId, projectId, {
      expectedRevision: projectState.nodeFlow.revision,
      expectedServerSeq: projectState.serverSeq,
      projectData: nextProjectData,
      actorId: `agent:${userId.slice(0, 24)}`,
      operationId,
    });
    projectCommit = {
      operationId,
      baseRevision: projectState.nodeFlow.revision,
      revision: committed.revision,
      serverSeq: committed.serverSeq,
    };
  }

  return {
    projectCommit,
    scriptEditProposals: splitNodeFlow.proposals.length
      ? splitNodeFlow.proposals
      : undefined,
  };
};
