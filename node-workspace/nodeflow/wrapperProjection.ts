import type { NodeFlowLink, NodeFlowNode } from "../types";
import { isLookbookNodeType } from "../../utils/lookbookIdentities";
import { PINOARD_MEMBERSHIP_RELATION } from "../../utils/pinoardWorkspace";
import { isFolderMembershipLink, isManusFolderNode } from "../manus/folder";

export type WrapperProjection = {
  hiddenNodeIds: Set<string>;
  memberIdsByWrapper: Map<string, string[]>;
  screenplayRootIds: Set<string>;
};

const isCollapsed = (node: NodeFlowNode) => node.data?.wrapperCollapsed === true;

const addMember = (members: Map<string, Set<string>>, wrapperId: string, memberId: string) => {
  if (!memberId || memberId === wrapperId) return;
  const current = members.get(wrapperId) || new Set<string>();
  current.add(memberId);
  members.set(wrapperId, current);
};

export const buildWrapperProjection = (
  nodes: NodeFlowNode[],
  links: NodeFlowLink[]
): WrapperProjection => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const lookbookIds = new Set(nodes.filter((node) => isLookbookNodeType(node.type)).map((node) => node.id));
  const leporelloIds = new Set(nodes.filter((node) => node.type === "leporello").map((node) => node.id));
  const pinoardIds = new Set(nodes.filter((node) => node.type === "pinoard").map((node) => node.id));
  const textNodeIds = new Set(nodes.filter((node) => node.type === "text").map((node) => node.id));
  const scriptNodeIds = new Set(nodes.filter((node) => node.type === "scriptPage").map((node) => node.id));
  const manusFolderIds = new Set(nodes.filter(isManusFolderNode).map((node) => node.id));
  const memberSets = new Map<string, Set<string>>();

  links.forEach((link) => {
    if (isFolderMembershipLink(link)) {
      if (manusFolderIds.has(link.source) && scriptNodeIds.has(link.target)) {
        addMember(memberSets, link.source, link.target);
      }
      return;
    }
    if (link.data?.relation === "lookbook-membership") {
      if (lookbookIds.has(link.source) && nodeById.has(link.target)) addMember(memberSets, link.source, link.target);
      if (lookbookIds.has(link.target) && nodeById.has(link.source)) addMember(memberSets, link.target, link.source);
      return;
    }
    if (link.data?.relation === "leporello-membership") {
      if (leporelloIds.has(link.source) && nodeById.has(link.target)) addMember(memberSets, link.source, link.target);
      if (leporelloIds.has(link.target) && nodeById.has(link.source)) addMember(memberSets, link.target, link.source);
      return;
    }
    if (link.data?.relation === PINOARD_MEMBERSHIP_RELATION) {
      if (pinoardIds.has(link.source) && textNodeIds.has(link.target)) {
        addMember(memberSets, link.source, link.target);
      }
      if (pinoardIds.has(link.target) && textNodeIds.has(link.source)) {
        addMember(memberSets, link.target, link.source);
      }
      return;
    }
  });

  const screenplayRootIds = new Set<string>();

  const hiddenNodeIds = new Set<string>();
  memberSets.forEach((memberIds, wrapperId) => {
    const wrapper = nodeById.get(wrapperId);
    if (!wrapper || !isCollapsed(wrapper)) return;
    memberIds.forEach((memberId) => hiddenNodeIds.add(memberId));
  });

  return {
    hiddenNodeIds,
    memberIdsByWrapper: new Map(
      Array.from(memberSets, ([wrapperId, memberIds]) => [wrapperId, Array.from(memberIds)])
    ),
    screenplayRootIds,
  };
};
