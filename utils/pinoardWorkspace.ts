import type { FlowLink, ProjectData } from "../types";
import { saveActiveFlowIntoProjects } from "../node-workspace/foundation/scaffold";
import type {
  NodeFlowNode,
  PinoardNodeData,
  TextNodeData,
} from "../node-workspace/types";

export const PINOARD_MEMBERSHIP_RELATION = "pinoard-membership" as const;

const getNodes = (projectData: ProjectData) => projectData.flow?.flowNodes || [];
const getLinks = (projectData: ProjectData) => projectData.flow?.links || [];

const persistFlow = (
  projectData: ProjectData,
  flowNodes: NodeFlowNode[],
  links: FlowLink[],
  now: number
): ProjectData => {
  const nextProjectData: ProjectData = {
    ...projectData,
    flow: {
      ...projectData.flow,
      revision: (projectData.flow?.revision || 0) + 1,
      flowNodes,
      links,
      graphLinks: projectData.flow?.graphLinks || [],
      globalAssetHistory: projectData.flow?.globalAssetHistory || [],
      activeView: projectData.flow?.activeView ?? null,
    },
  };
  return {
    ...nextProjectData,
    flowProjects: saveActiveFlowIntoProjects(nextProjectData, now),
  };
};

export const createPinoardMembershipLink = (
  pinoardId: string,
  textNodeId: string
): FlowLink => ({
  id: `pinoard-member-${pinoardId}-${textNodeId}`,
  source: pinoardId,
  target: textNodeId,
  sourceHandle: "text",
  targetHandle: "text",
  data: { relation: PINOARD_MEMBERSHIP_RELATION },
});

export const getPinoardMemberIds = (
  projectData: ProjectData,
  pinoardId: string
) => {
  const textIds = new Set(
    getNodes(projectData)
      .filter((node) => node.type === "text")
      .map((node) => node.id)
  );
  const memberIds: string[] = [];
  getLinks(projectData).forEach((link) => {
    if (link.data?.relation !== PINOARD_MEMBERSHIP_RELATION) return;
    const oppositeId =
      link.source === pinoardId
        ? link.target
        : link.target === pinoardId
          ? link.source
          : null;
    if (oppositeId && textIds.has(oppositeId) && !memberIds.includes(oppositeId)) {
      memberIds.push(oppositeId);
    }
  });
  return memberIds;
};

export const getPinoardMembers = (
  projectData: ProjectData,
  pinoardId: string
) => {
  const memberIds = new Set(getPinoardMemberIds(projectData, pinoardId));
  return getNodes(projectData).filter(
    (node): node is NodeFlowNode & { data: TextNodeData } =>
      node.type === "text" && memberIds.has(node.id)
  );
};

export const findPinoardForText = (
  projectData: ProjectData,
  textNodeId: string
) => {
  const pinoardIds = new Set(
    getNodes(projectData)
      .filter((node) => node.type === "pinoard")
      .map((node) => node.id)
  );
  for (const link of getLinks(projectData)) {
    if (link.data?.relation !== PINOARD_MEMBERSHIP_RELATION) continue;
    if (link.source === textNodeId && pinoardIds.has(link.target)) return link.target;
    if (link.target === textNodeId && pinoardIds.has(link.source)) return link.source;
  }
  return null;
};

export const assignTextToPinoard = (
  projectData: ProjectData,
  pinoardId: string,
  textNodeId: string,
  now = Date.now()
): ProjectData => {
  const nodes = getNodes(projectData);
  if (
    !nodes.some((node) => node.id === pinoardId && node.type === "pinoard") ||
    !nodes.some((node) => node.id === textNodeId && node.type === "text")
  ) {
    return projectData;
  }
  const membership = createPinoardMembershipLink(pinoardId, textNodeId);
  const links = [
    ...getLinks(projectData).filter(
      (link) =>
        !(
          link.data?.relation === PINOARD_MEMBERSHIP_RELATION &&
          (link.source === textNodeId || link.target === textNodeId)
        )
    ),
    membership,
  ];
  return persistFlow(projectData, nodes, links, now);
};

export const ensurePinoardForText = (
  projectData: ProjectData,
  textNodeId: string,
  now = Date.now()
): { projectData: ProjectData; pinoardId: string | null } => {
  const nodes = getNodes(projectData);
  const textNode = nodes.find(
    (node) => node.id === textNodeId && node.type === "text"
  );
  if (!textNode) return { projectData, pinoardId: null };

  const assignedId = findPinoardForText(projectData, textNodeId);
  if (assignedId) return { projectData, pinoardId: assignedId };

  const existingPinoard = nodes.find((node) => node.type === "pinoard");
  if (existingPinoard) {
    return {
      projectData: assignTextToPinoard(
        projectData,
        existingPinoard.id,
        textNodeId,
        now
      ),
      pinoardId: existingPinoard.id,
    };
  }

  const pinoardId = `pinoard-${now.toString(36)}-${nodes.length.toString(36)}`;
  const pinoardNode: NodeFlowNode = {
    id: pinoardId,
    type: "pinoard",
    position: {
      x: textNode.position.x - 428,
      y: textNode.position.y + 12,
    },
    style: { width: 372, height: 278 },
    data: {
      title: "Pinoard",
      wrapperCollapsed: false,
    } as PinoardNodeData,
  };
  const membership = createPinoardMembershipLink(pinoardId, textNodeId);
  return {
    projectData: persistFlow(
      projectData,
      [...nodes, pinoardNode],
      [...getLinks(projectData), membership],
      now
    ),
    pinoardId,
  };
};

export const addPinoardNote = (
  projectData: ProjectData,
  pinoardId: string,
  now = Date.now()
): { projectData: ProjectData; nodeId: string | null } => {
  const nodes = getNodes(projectData);
  const wrapper = nodes.find(
    (node) => node.id === pinoardId && node.type === "pinoard"
  );
  if (!wrapper) return { projectData, nodeId: null };
  const memberCount = getPinoardMemberIds(projectData, pinoardId).length;
  const nodeId = `text-pinoard-${now.toString(36)}-${nodes.length.toString(36)}`;
  const note: NodeFlowNode = {
    id: nodeId,
    type: "text",
    position: {
      x: wrapper.position.x + 428 + (memberCount % 2) * 344,
      y: wrapper.position.y + Math.floor(memberCount / 2) * 226,
    },
    style: { width: 320, height: 180 },
    data: {
      title: `灵感 ${memberCount + 1}`,
      text: "",
      documentKind: "note",
      format: "markdown",
    } as TextNodeData,
  };
  return {
    projectData: persistFlow(
      projectData,
      [...nodes, note],
      [...getLinks(projectData), createPinoardMembershipLink(pinoardId, nodeId)],
      now
    ),
    nodeId,
  };
};

export const updatePinoardNote = (
  projectData: ProjectData,
  pinoardId: string,
  nodeId: string,
  patch: Pick<TextNodeData, "title" | "text">,
  now = Date.now()
): ProjectData => {
  if (!getPinoardMemberIds(projectData, pinoardId).includes(nodeId)) {
    return projectData;
  }
  let changed = false;
  const nodes = getNodes(projectData).map((node) => {
    if (node.id !== nodeId || node.type !== "text") return node;
    if (node.data.title === patch.title && node.data.text === patch.text) return node;
    changed = true;
    return { ...node, data: { ...node.data, ...patch } };
  });
  return changed
    ? persistFlow(projectData, nodes, getLinks(projectData), now)
    : projectData;
};

export const removePinoardNote = (
  projectData: ProjectData,
  pinoardId: string,
  nodeId: string,
  now = Date.now()
): ProjectData => {
  if (!getPinoardMemberIds(projectData, pinoardId).includes(nodeId)) {
    return projectData;
  }
  return persistFlow(
    projectData,
    getNodes(projectData).filter((node) => node.id !== nodeId),
    getLinks(projectData).filter(
      (link) => link.source !== nodeId && link.target !== nodeId
    ),
    now
  );
};
