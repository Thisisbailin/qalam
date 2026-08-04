import type { AgentUiContext } from "../../../agents/runtime/types";

export type StyloSubmitRequest = {
  id: number;
  projectId?: string;
  text: string;
  uiContext?: AgentUiContext;
};

export type AgentScriptEditProposal = {
  id: string;
  nodeId: string;
  documentId?: string;
  title: string;
  content: string;
  receivedAt: number;
};

export type AgentScriptEditProposalBatch = {
  id: string;
  proposals: AgentScriptEditProposal[];
};

export type ScriptDocumentCommit = {
  nodeId: string;
  title: string;
  content: string;
  preview: string;
  stats?: {
    lines: number;
    scenes: number;
    characters: number;
    locations: number;
    words: number;
    glyphs: number;
    estimatedPages: number;
    estimatedMinutes: number;
    dialoguePercent: number;
  };
};

export type ScriptPageSplitCommit = {
  sourceNodeId: string;
  title: string;
  sourceContent: string;
  nextContent: string;
  /** 手动分页（硬边界）：动态重排不会把该页内容流回上一页。 */
  pinned?: boolean;
};

export type ScriptPageReorderCommit = {
  orderedNodeIds: string[];
};
