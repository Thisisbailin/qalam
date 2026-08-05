import { createStyloAgentBridge } from "../../agents/bridge/nodeFlowBridgeCore";
import type { Connection } from "@xyflow/react";
import type { StyloRunResult } from "../../agents/runtime/types";
import type { AgentScriptEditProposal } from "../../agents/runtime/types";
import type { ProjectData } from "../../types";
import type { NodeFlowFile, NodeFlowNode, NodeFlowNodeData, NodeType } from "../../node-workspace/types";
import { createDefaultNodeFlowNodeData } from "../../node-workspace/nodeflow/defaults";
import { DEFAULT_NODE_DIMENSIONS } from "../../node-workspace/nodeflow/placement";
import type { NodeFlowExecutionApprovalProposal } from "../../node-workspace/nodeflow/approvals";
import { createNodeFlowGraphLink, removeNodeFlowGraphLink } from "../../node-workspace/nodeflow/graphLinks";
import {
  appendNodeToNodeFlow,
  connectNodesInNodeFlow,
  patchNodeFlowNodeData,
  patchNodeFlowNodeStyle,
  removeLinkFromNodeFlow,
  removeNodeFromNodeFlow,
  toggleNodeFlowLinkPauseInState,
} from "../../node-workspace/nodeflow/mutations";

export const createAgentProjectData = (
  projectData: ProjectData | undefined,
  nodeFlow: NodeFlowFile | undefined,
  projectId: string
): ProjectData => {
  const activeProject = projectData?.flowProjects?.find((project) => project.id === projectId);
  return {
    fileName: activeProject?.title?.trim() || projectData?.fileName?.trim() || nodeFlow?.name || "",
    rawScript: "",
    episodes: [],
    roles: Array.isArray(projectData?.roles) ? projectData.roles : [],
    designAssets: Array.isArray(projectData?.designAssets) ? projectData.designAssets : [],
    canvas: projectData?.canvas || { viewport: null },
    flow: {
      flowNodes: [],
      links: [],
    },
    activeFlowProjectId: projectId,
    phase5Usage: projectData?.phase5Usage,
    stats: projectData?.stats || { context: { total: 0, success: 0, error: 0 } },
  };
};

export const createAgentProjectPatch = (
  projectData: ProjectData,
  projectId: string
): StyloRunResult["updatedProjectPatch"] => {
  const activeProject = projectData.flowProjects?.find((project) => project.id === projectId);
  return {
    activeFlowProjectId: projectId,
    roles: Array.isArray(projectData.roles) ? projectData.roles : [],
    designAssets: Array.isArray(projectData.designAssets) ? projectData.designAssets : [],
    flow: projectData.flow,
    flowProjects: activeProject ? [activeProject] : undefined,
  };
};

export const hasMeaningfulProjectPatch = (patch: StyloRunResult["updatedProjectPatch"]) =>
  Boolean(
    patch &&
      (Array.isArray(patch.roles) ||
        Array.isArray(patch.designAssets) ||
        patch.flow ||
        (Array.isArray(patch.flowProjects) && patch.flowProjects.length > 0))
  );

export const mergeAgentNodeFlowIntoProjectData = (
  source: ProjectData,
  agentProjectData: ProjectData,
  nodeFlow: NodeFlowFile,
  projectId: string,
  updatedAt = Date.now(),
): ProjectData => {
  const next = structuredClone(source);
  const nextFlow = {
    revision: nodeFlow.revision,
    flowNodes: nodeFlow.nodes,
    links: nodeFlow.links,
    graphLinks: nodeFlow.graphLinks || [],
    linkStyle: nodeFlow.linkStyle,
    globalAssetHistory: nodeFlow.globalAssetHistory || [],
    activeView: nodeFlow.activeView ?? null,
  } as NonNullable<ProjectData["flow"]>;
  const roles = Array.isArray(agentProjectData.roles) ? agentProjectData.roles : next.roles;
  const designAssets = Array.isArray(agentProjectData.designAssets)
    ? agentProjectData.designAssets
    : next.designAssets;
  const targetIndex = next.flowProjects?.findIndex((project) => project.id === projectId) ?? -1;
  if (targetIndex < 0 || !next.flowProjects) {
    throw new Error("The selected Stylo project is missing from the realtime project document.");
  }
  const target = next.flowProjects[targetIndex];
  next.flowProjects[targetIndex] = {
    ...target,
    flow: nextFlow,
    roles,
    designAssets,
    updatedAt,
  };
  if (!next.activeFlowProjectId || next.activeFlowProjectId === projectId) {
    next.activeFlowProjectId = projectId;
    next.flow = nextFlow;
    next.roles = roles;
    next.designAssets = designAssets;
  }
  return next;
};

const readScriptDocument = (node: NodeFlowNode) => {
  const data = (node.data || {}) as Record<string, unknown>;
  const content = typeof data.content === "string"
    ? data.content
    : typeof data.text === "string"
      ? data.text
      : "";
  return {
    title: typeof data.title === "string" && data.title.trim() ? data.title : "剧本文档",
    content,
    documentId: typeof data.documentId === "string" && data.documentId.trim()
      ? data.documentId
      : undefined,
  };
};

export const splitAgentScriptEditProposals = (
  source: NodeFlowFile,
  candidate: NodeFlowFile,
  receivedAt = Date.now(),
): {
  committedNodeFlow: NodeFlowFile;
  proposals: AgentScriptEditProposal[];
  hasCommittedNodeFlowMutation: boolean;
} => {
  const sourceById = new Map(source.nodes.map((node) => [node.id, node]));
  const proposals: AgentScriptEditProposal[] = [];
  const proposalNodeIds = new Set<string>();

  candidate.nodes.forEach((node, index) => {
    if (node.type !== "scriptPage") return;
    const previous = sourceById.get(node.id);
    if (!previous || previous.type !== "scriptPage") return;
    const previousDocument = readScriptDocument(previous);
    const nextDocument = readScriptDocument(node);
    if (previousDocument.content === nextDocument.content) return;
    proposalNodeIds.add(node.id);
    proposals.push({
      id: `agent-script-edit-${receivedAt.toString(36)}-${index}`,
      nodeId: node.id,
      documentId: nextDocument.documentId || previousDocument.documentId,
      title: nextDocument.title,
      content: nextDocument.content,
      receivedAt,
    });
  });

  const restoredNodes = candidate.nodes.map((node) => {
    if (!proposalNodeIds.has(node.id)) return node;
    const previous = sourceById.get(node.id);
    if (!previous) return node;
    const previousData = (previous.data || {}) as Record<string, unknown>;
    const nextData = { ...((node.data || {}) as Record<string, unknown>) };
    ["title", "text", "content", "preview", "updatedAt"].forEach((key) => {
      if (key in previousData) nextData[key] = previousData[key];
      else delete nextData[key];
    });
    return { ...node, data: nextData as NodeFlowNode["data"] };
  });
  const restored = { ...candidate, nodes: restoredNodes };
  const comparison = { ...restored, revision: source.revision };
  return {
    committedNodeFlow: restored,
    proposals,
    hasCommittedNodeFlowMutation: JSON.stringify(comparison) !== JSON.stringify(source),
  };
};

export const createNodeFlowBridgeState = (
  projectData: ProjectData,
  nodeFlow?: NodeFlowFile
) => {
  let currentProjectData = projectData;
  let projectDataUpdated = false;
  const initialNodeFlow: NodeFlowFile = nodeFlow || {
    version: 2,
    revision: 0,
    name: projectData.fileName || "Stylo NodeFlow",
    nodes: [],
    links: [],
    linkStyle: "angular",
    globalAssetHistory: [],
    activeView: null,
  };
  let currentNodeFlow = structuredClone(initialNodeFlow);
  let nodeFlowUpdated = false;
  let currentExecutionApprovals: Record<string, NodeFlowExecutionApprovalProposal> = {};
  let executionApprovalsUpdated = false;
  let nodeIdCounter = (currentNodeFlow.nodes || []).reduce((max, node) => {
    const match = String(node.id || "").match(/-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  const getViewport = () => currentNodeFlow.viewport || null;
  const addNode = (type: NodeType, position: { x: number; y: number }, parentId?: string, extraData?: Partial<NodeFlowNodeData>) => {
    const id = `${type}-${++nodeIdCounter}`;
    const dim = DEFAULT_NODE_DIMENSIONS[type];
    const newNode: NodeFlowNode = {
      id,
      type,
      position,
      parentId,
      extent: parentId ? "parent" : undefined,
      data: { ...createDefaultNodeFlowNodeData(type), ...(extraData || {}) } as NodeFlowNodeData,
      style: dim ? { width: dim.width, height: dim.height } : undefined,
    };
    currentNodeFlow = appendNodeToNodeFlow(currentNodeFlow, newNode) as NodeFlowFile;
    nodeFlowUpdated = true;
    return id;
  };

  const updateNodeStyle = (nodeId: string, style: Record<string, unknown>) => {
    currentNodeFlow = patchNodeFlowNodeStyle(currentNodeFlow, nodeId, style) as NodeFlowFile;
    nodeFlowUpdated = true;
  };

  const updateNodeData = (nodeId: string, data: Partial<NodeFlowNodeData>) => {
    currentNodeFlow = patchNodeFlowNodeData(currentNodeFlow, nodeId, data) as NodeFlowFile;
    nodeFlowUpdated = true;
  };

  const moveNode = (nodeId: string, position: { x: number; y: number }) => {
    currentNodeFlow = {
      ...currentNodeFlow,
      revision: currentNodeFlow.revision + 1,
      nodes: currentNodeFlow.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              position: {
                x: position.x,
                y: position.y,
              },
            }
          : node
      ),
    };
    nodeFlowUpdated = true;
  };

  const removeNode = (nodeId: string) => {
    currentNodeFlow = removeNodeFromNodeFlow(currentNodeFlow, nodeId) as NodeFlowFile;
    nodeFlowUpdated = true;
  };

  const connectNodes = (connection: Connection) => {
    currentNodeFlow = connectNodesInNodeFlow(currentNodeFlow, connection) as NodeFlowFile;
    nodeFlowUpdated = true;
  };

  const removeLink = (linkId: string) => {
    currentNodeFlow = removeLinkFromNodeFlow(currentNodeFlow, linkId) as NodeFlowFile;
    nodeFlowUpdated = true;
  };

  const addGraphLink = (sourceRef: string, targetRef: string) => {
    const result = createNodeFlowGraphLink(currentNodeFlow.graphLinks || [], sourceRef, targetRef);
    currentNodeFlow = {
      ...currentNodeFlow,
      revision: currentNodeFlow.revision + 1,
      graphLinks: result.links,
    };
    nodeFlowUpdated = true;
    return result.linkId;
  };

  const removeGraphLink = (linkId: string) => {
    currentNodeFlow = {
      ...currentNodeFlow,
      revision: currentNodeFlow.revision + 1,
      graphLinks: removeNodeFlowGraphLink(currentNodeFlow.graphLinks || [], linkId),
    };
    nodeFlowUpdated = true;
  };

  const toggleLinkPause = (linkId: string) => {
    currentNodeFlow = toggleNodeFlowLinkPauseInState(currentNodeFlow, linkId) as NodeFlowFile;
    nodeFlowUpdated = true;
  };

  return {
    bridge: createStyloAgentBridge({
      getProjectData: () => currentProjectData,
      getNodeFlowSnapshot: () => currentNodeFlow,
      getPendingExecutionApprovals: () => Object.values(currentExecutionApprovals),
      updateProjectData: (updater: (prev: ProjectData) => ProjectData) => {
        currentProjectData = updater(currentProjectData);
        projectDataUpdated = true;
      },
      addNode,
      updateNodeData,
      moveNode,
      addGraphLink,
      removeGraphLink,
      updateNodeStyle: (nodeId, style) => updateNodeStyle(nodeId, style),
      connectNodes,
      removeNode,
      removeLink,
      toggleLinkPause,
      requestExecutionApproval: (proposal) => {
        currentExecutionApprovals = {
          ...currentExecutionApprovals,
          [proposal.nodeId]: proposal,
        };
        executionApprovalsUpdated = true;
      },
      clearExecutionApproval: (nodeId) => {
        if (!currentExecutionApprovals[nodeId]) return;
        const next = { ...currentExecutionApprovals };
        delete next[nodeId];
        currentExecutionApprovals = next;
        executionApprovalsUpdated = true;
      },
    }),
    getProjectData: () => currentProjectData,
    hasUpdatedProjectData: () => projectDataUpdated,
    getNodeFlow: () => currentNodeFlow,
    hasUpdatedNodeFlow: () => nodeFlowUpdated,
    getExecutionApprovals: () => Object.values(currentExecutionApprovals),
    hasUpdatedExecutionApprovals: () => executionApprovalsUpdated,
  };
};
