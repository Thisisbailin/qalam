import type { ProjectData, FlowProject, FlowState } from "../../types";
import type { NodeFlowNode, NodeFlowNodeData } from "../types";
import { createDefaultNodeFlowNodeData } from "../nodeflow/defaults";
import {
  DEFAULT_FLOW_PROJECT_DURATION,
  normalizeFlowProjectDuration,
} from "../../utils/flowProject";
import {
  FOUNDATION_AXES,
  FOUNDATION_AXIS_DEFINITIONS,
  FOUNDATION_WEIGHTED_AXES,
  getFoundationAxisDefinition,
  type FoundationAxis,
  type FoundationWeightedAxis,
} from "./axes";
import { createFoundationMembershipLink, normalizeFoundationMemberships } from "./membership";

export type { FoundationAxis, FoundationWeightedAxis } from "./axes";

const ensureFlow = (flow?: FlowState): FlowState => ({
  revision: typeof flow?.revision === "number" ? flow.revision : 0,
  flowNodes: Array.isArray(flow?.flowNodes) ? flow.flowNodes : [],
  graphLinks: Array.isArray(flow?.graphLinks) ? flow.graphLinks : [],
  globalAssetHistory: Array.isArray(flow?.globalAssetHistory) ? flow.globalAssetHistory : [],
  linkStyle: flow?.linkStyle || "curved",
  activeView: flow?.activeView ?? null,
  links: Array.isArray(flow?.links) ? flow.links : [],
});

export type FoundationViewBlock = {
  id: string;
  title: string;
  content: string;
  color: string;
  order: number;
  boundaryNodeIds: string[];
};

export type FoundationTimeBlock = FoundationViewBlock & {
  startMin: number;
  durationMin: number;
};

export type FoundationSpaceBlock = FoundationViewBlock & {
  width: number;
};

export type FoundationProjectHead = {
  title: string;
  content: string;
};

export type FoundationScaffold = {
  id: string;
  title: string;
  durationMin: number;
  head?: FoundationProjectHead;
  spaceAxisBlocks?: FoundationSpaceBlock[];
  axisBlocks?: Partial<Record<FoundationWeightedAxis, FoundationSpaceBlock[]>>;
  blocks: FoundationTimeBlock[];
};

const FLOW_PROJECT_LIMIT = 24;
const FLOW_PROJECT_COLOR_STYLES = [
  { color: "amber" },
  { color: "moss" },
  { color: "blue" },
  { color: "rose" },
  { color: "violet" },
  { color: "slate" },
] as const;

export const TIMELINE_COLORS = [
  { name: "墨", value: "slate" },
  { name: "琥珀", value: "amber" },
  { name: "苔绿", value: "moss" },
  { name: "海蓝", value: "blue" },
  { name: "胭脂", value: "rose" },
  { name: "紫藤", value: "violet" },
];

export const MIN_TIMELINE_BLOCK_MINUTES = 1;
export const DEFAULT_TIMELINE_DURATION = DEFAULT_FLOW_PROJECT_DURATION;
const FOUNDATION_ARCHIVE_NODE_SIZE = { width: 320, height: 252 };
const FOLDER_NODE_SIZE = { width: 230, height: 128 };
const FOUNDATION_LAYOUT = {
  root: { x: 80, y: 40 },
  projectIndex: { x: 360, y: 24 },
  timeAxis: { x: 80, y: 260 },
  spaceAxis: { x: 80, y: 780 },
  characterAxis: { x: 80, y: 1300 },
  sceneAxis: { x: 80, y: 1820 },
  blockStartX: 360,
  blockArchiveOffsetX: 270,
  blockColumnWidth: 620,
  blockRowHeight: 220,
} as const;
const FOUNDATION_AXIS_POSITIONS: Record<FoundationAxis, { x: number; y: number }> = {
  time: FOUNDATION_LAYOUT.timeAxis,
  space: FOUNDATION_LAYOUT.spaceAxis,
  character: FOUNDATION_LAYOUT.characterAxis,
  scene: FOUNDATION_LAYOUT.sceneAxis,
};
export const FOUNDATION_ROOT_NODE_PREFIX = "project-root-";
export const FOUNDATION_PROJECT_INDEX_DEPTH = 3;
export type FoundationNodeRole =
  | "project-root"
  | "project-index"
  | "axis-folder"
  | "block-folder"
  | "block-document";

export const isFoundationBlockSelectionActive = (
  activeAxis: FoundationAxis,
  activeBlockId: string,
  targetAxis: FoundationAxis,
  targetBlockId: string
) => activeAxis === targetAxis && activeBlockId === targetBlockId;

type FoundationNodeMeta = {
  foundationRole: FoundationNodeRole;
  foundationAxis?: FoundationAxis;
  foundationParentId?: string;
  foundationOrder?: number;
  locked?: boolean;
  readOnly?: boolean;
};

export const DEFAULT_TIMELINE_HEAD: FoundationProjectHead = {
  title: "项目索引",
  content: "项目根文档，组织时间、空间、角色与场景四条轴的文件树。",
};

const createTimelineBlock = (
  id: string,
  title: string,
  durationMin: number,
  order: number,
  color: string,
  content = ""
): FoundationTimeBlock => ({
  id,
  title,
  content,
  startMin: 0,
  durationMin,
  color,
  order,
  boundaryNodeIds: [],
});

export const createSpaceBlock = (
  id: string,
  title: string,
  order: number,
  width: number,
  color: string,
  content = ""
): FoundationSpaceBlock => ({
  id,
  title,
  content,
  color,
  order,
  width,
  boundaryNodeIds: [],
});

export const createDefaultSpaceBlocks = (): FoundationSpaceBlock[] => [
  createSpaceBlock("space-spec", "规格", 0, 1, "slate", "项目类型、画幅、总时长、作者、版本与基础制作规格。"),
  createSpaceBlock("space-style", "风格", 1, 1, "rose", "影像、语气、对白、节奏与视觉参考。"),
  createSpaceBlock("space-characters", "角色", 2, 1, "amber", "角色、动机、关系与人物档案。"),
  createSpaceBlock("space-scenes", "场景", 3, 1, "blue", "地点、空间、动线与场景关系。"),
];

export const createDefaultWeightedAxisBlocks = (axis: FoundationWeightedAxis): FoundationSpaceBlock[] => {
  if (axis === "space") return createDefaultSpaceBlocks();
  const definition = getFoundationAxisDefinition(axis);
  return [
    createSpaceBlock(
      `${axis}-block-1`,
      `${definition.blockLabel} 1`,
      0,
      1,
      axis === "character" ? "amber" : "blue",
      ""
    ),
  ];
};

const distributeRemainder = (blocks: FoundationTimeBlock[], targetDuration: number) => {
  const next = blocks.map((block) => ({ ...block, durationMin: Math.max(MIN_TIMELINE_BLOCK_MINUTES, Math.round(block.durationMin)) }));
  let total = next.reduce((sum, block) => sum + block.durationMin, 0);
  let guard = 0;

  while (total < targetDuration && next.length && guard < 1000) {
    next[guard % next.length].durationMin += 1;
    total += 1;
    guard += 1;
  }

  guard = 0;
  while (total > targetDuration && next.length && guard < 1000) {
    const block = next[guard % next.length];
    if (block.durationMin > MIN_TIMELINE_BLOCK_MINUTES) {
      block.durationMin -= 1;
      total -= 1;
    }
    guard += 1;
  }

  return next;
};

export const recalculateTimelineBlocks = (blocks: FoundationTimeBlock[], durationMin: number) => {
  const targetDuration = normalizeFlowProjectDuration(durationMin);
  const sortedBlocks = blocks
    .slice()
    .sort((a, b) => a.order - b.order);
  const maxBlockCount = Math.max(1, Math.floor(targetDuration / MIN_TIMELINE_BLOCK_MINUTES));
  const fittedBlocks = sortedBlocks.slice(0, maxBlockCount);
  const overflowBlocks = sortedBlocks.slice(maxBlockCount);
  if (overflowBlocks.length && fittedBlocks.length) {
    const lastIndex = fittedBlocks.length - 1;
    const lastBlock = fittedBlocks[lastIndex];
    fittedBlocks[lastIndex] = {
      ...lastBlock,
      content: [lastBlock.content, ...overflowBlocks.map((block) => block.content)].filter(Boolean).join("\n\n"),
      durationMin: lastBlock.durationMin + overflowBlocks.reduce((sum, block) => sum + block.durationMin, 0),
      boundaryNodeIds: Array.from(new Set([
        ...lastBlock.boundaryNodeIds,
        ...overflowBlocks.flatMap((block) => block.boundaryNodeIds),
      ])),
    };
  }
  const ordered = distributeRemainder(
    fittedBlocks
      .map((block, index) => ({
        ...block,
        order: index,
        boundaryNodeIds: Array.isArray(block.boundaryNodeIds) ? Array.from(new Set(block.boundaryNodeIds)) : [],
      })),
    targetDuration
  );
  let cursor = 0;
  return ordered.map((block, index) => {
    const next = { ...block, order: index, startMin: cursor };
    cursor += next.durationMin;
    return next;
  });
};

export const normalizeSpaceBlocks = (blocks?: FoundationSpaceBlock[]) =>
  (() => {
    const base = Array.isArray(blocks) && blocks.length ? blocks : createDefaultSpaceBlocks();
    const hasSpec = base.some((block) => block.id === "space-spec" || block.title === "规格");
    return hasSpec ? base : [createDefaultSpaceBlocks()[0], ...base];
  })()
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((block, index) => ({
      ...block,
      id: block.id || `space-block-${index + 1}`,
      title: block.title || `全局视角 ${index + 1}`,
      content: block.content || "",
      color: block.color || TIMELINE_COLORS[index % TIMELINE_COLORS.length].value,
      order: index,
      width: Math.max(0.45, Number(block.width) || 1),
      boundaryNodeIds: Array.isArray(block.boundaryNodeIds) ? Array.from(new Set(block.boundaryNodeIds)) : [],
    }));

export const normalizeWeightedAxisBlocks = (
  axis: FoundationWeightedAxis,
  blocks?: FoundationSpaceBlock[]
) => {
  const base = Array.isArray(blocks) && blocks.length ? blocks : createDefaultWeightedAxisBlocks(axis);
  const withRequiredSpaceSpec =
    axis === "space" && !base.some((block) => block.id === "space-spec" || block.title === "规格")
      ? [createDefaultSpaceBlocks()[0], ...base]
      : base;
  const definition = getFoundationAxisDefinition(axis);
  return withRequiredSpaceSpec
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((block, index) => ({
      ...block,
      id: block.id || `${axis}-block-${index + 1}`,
      title: block.title || `${definition.blockLabel} ${index + 1}`,
      content: block.content || "",
      color: block.color || TIMELINE_COLORS[index % TIMELINE_COLORS.length].value,
      order: index,
      width: Math.max(0.45, Number(block.width) || 1),
      boundaryNodeIds: Array.isArray(block.boundaryNodeIds) ? Array.from(new Set(block.boundaryNodeIds)) : [],
    }));
};

export const getWeightedAxisBlocks = (
  timeline: FoundationScaffold,
  axis: FoundationWeightedAxis
) => normalizeWeightedAxisBlocks(
  axis,
  timeline.axisBlocks?.[axis] ?? (axis === "space" ? timeline.spaceAxisBlocks : undefined)
);

export const setWeightedAxisBlocks = (
  timeline: FoundationScaffold,
  axis: FoundationWeightedAxis,
  blocks: FoundationSpaceBlock[]
): FoundationScaffold => {
  const normalized = normalizeWeightedAxisBlocks(axis, blocks);
  return {
    ...timeline,
    ...(axis === "space" ? { spaceAxisBlocks: normalized } : {}),
    axisBlocks: { ...timeline.axisBlocks, [axis]: normalized },
  };
};

const createFoundationFolderNode = (
  id: string,
  title: string,
  position: { x: number; y: number },
  meta: FoundationNodeMeta
): NodeFlowNode => ({
  id,
  type: "folder",
  position,
  style: FOLDER_NODE_SIZE,
  deletable: false,
  connectable: meta.foundationRole === "block-folder",
  data: {
    ...createDefaultNodeFlowNodeData("folder"),
    title,
    ...meta,
    locked: true,
  },
});

const createFoundationArchiveNode = (
  id: string,
  title: string,
  content: string,
  position: { x: number; y: number },
  meta: FoundationNodeMeta
): NodeFlowNode => ({
  id,
  type: "mdText",
  position,
  style: FOUNDATION_ARCHIVE_NODE_SIZE,
  deletable: false,
  connectable: false,
  data: {
    ...createDefaultNodeFlowNodeData("mdText"),
    documentId: id.replace(/^md-/, ""),
    title,
    text: content,
    content,
    preview: compactMarkdownPreview(content),
    documentKind: "archive",
    format: "markdown",
    ...meta,
    locked: true,
  } as NodeFlowNodeData,
});

export const createFoundationLink = (source: string, target: string): FlowState["links"][number] => ({
  id: `link-${source}-${target}-text-text`,
  source,
  target,
  sourceHandle: "text",
  targetHandle: "text",
});

const getFoundationSeedIds = (rootNodeId: string) => ({
  projectIndexId: `${rootNodeId}--project-index`,
  timeAxisId: `${rootNodeId}--time-axis`,
  spaceAxisId: `${rootNodeId}--space-axis`,
  characterAxisId: `${rootNodeId}--character-axis`,
  sceneAxisId: `${rootNodeId}--scene-axis`,
});

const getLegacyAxisIndexIds = (rootNodeId: string) =>
  new Set([`${rootNodeId}--time-axis-index`, `${rootNodeId}--space-axis-index`]);

const createBlockArchiveMarkdown = (
  title: string,
  axis: string,
  fields: string[],
  content: string
) => [`# ${title}`, "", `- 轴：${axis}`, ...fields, "", "## 用户记录", "", content || "未记录"].join("\n");

export const buildFoundationGraphSeed = (
  projectTitle: string,
  durationMin: number,
  rootNodeId: string
): { nodes: NodeFlowNode[]; links: FlowState["links"] } => {
  const ids = getFoundationSeedIds(rootNodeId);
  const timeBlocks = createDefaultTimeline(durationMin).blocks;
  const weightedAxisBlocks = new Map(
    FOUNDATION_WEIGHTED_AXES.map((axis) => [axis, createDefaultWeightedAxisBlocks(axis)])
  );
  const nodes: NodeFlowNode[] = [
    createFoundationFolderNode(rootNodeId, projectTitle || "项目", FOUNDATION_LAYOUT.root, {
      foundationRole: "project-root",
    }),
    createFoundationArchiveNode(
      ids.projectIndexId,
      "项目索引.md",
      [
        "# 项目索引",
        "",
        `- 项目：${projectTitle || "项目"}`,
        `- 预估时长：${durationMin} min`,
        `- 文件夹解析深度：${FOUNDATION_PROJECT_INDEX_DEPTH}`,
        "",
        "## 结构",
        "",
        "- 时间轴",
        "- 空间轴",
        "- 角色轴",
        "- 场景轴",
      ].join("\n"),
      FOUNDATION_LAYOUT.projectIndex,
      {
        foundationRole: "project-index",
        foundationParentId: rootNodeId,
        readOnly: true,
      }
    ),
    createFoundationFolderNode(ids.timeAxisId, "时间轴", FOUNDATION_LAYOUT.timeAxis, {
      foundationRole: "axis-folder",
      foundationAxis: "time",
      foundationParentId: rootNodeId,
    }),
    createFoundationFolderNode(ids.spaceAxisId, "空间轴", FOUNDATION_LAYOUT.spaceAxis, {
      foundationRole: "axis-folder",
      foundationAxis: "space",
      foundationParentId: rootNodeId,
    }),
    createFoundationFolderNode(ids.characterAxisId, "角色轴", FOUNDATION_LAYOUT.characterAxis, {
      foundationRole: "axis-folder",
      foundationAxis: "character",
      foundationParentId: rootNodeId,
    }),
    createFoundationFolderNode(ids.sceneAxisId, "场景轴", FOUNDATION_LAYOUT.sceneAxis, {
      foundationRole: "axis-folder",
      foundationAxis: "scene",
      foundationParentId: rootNodeId,
    }),
  ];
  const links: FlowState["links"] = [
    createFoundationLink(rootNodeId, ids.projectIndexId),
    createFoundationLink(rootNodeId, ids.timeAxisId),
    createFoundationLink(rootNodeId, ids.spaceAxisId),
    createFoundationLink(rootNodeId, ids.characterAxisId),
    createFoundationLink(rootNodeId, ids.sceneAxisId),
  ];

  timeBlocks.forEach((block, index) => {
    const folderId = `${rootNodeId}--time-block-${index + 1}`;
    const archiveId = `${folderId}--archive`;
    nodes.push(
      createFoundationFolderNode(
        folderId,
        block.title,
        { x: FOUNDATION_LAYOUT.blockStartX + (index % 2) * FOUNDATION_LAYOUT.blockColumnWidth, y: getFoundationAxisDefinition("time").layoutY + Math.floor(index / 2) * FOUNDATION_LAYOUT.blockRowHeight },
        {
          foundationRole: "block-folder",
          foundationAxis: "time",
          foundationParentId: ids.timeAxisId,
        }
      ),
      createFoundationArchiveNode(
        archiveId,
        `${block.title}档案.md`,
        createBlockArchiveMarkdown(block.title, "时间轴", [
          `- 起点：${block.startMin} min`,
          `- 时长：${block.durationMin} min`,
          `- 颜色：${block.color}`,
        ], block.content),
        { x: FOUNDATION_LAYOUT.blockStartX + FOUNDATION_LAYOUT.blockArchiveOffsetX + (index % 2) * FOUNDATION_LAYOUT.blockColumnWidth, y: getFoundationAxisDefinition("time").layoutY - 18 + Math.floor(index / 2) * FOUNDATION_LAYOUT.blockRowHeight },
        {
          foundationRole: "block-document",
          foundationAxis: "time",
          foundationParentId: folderId,
        }
      )
    );
    links.push(createFoundationLink(ids.timeAxisId, folderId), createFoundationLink(folderId, archiveId));
  });

  FOUNDATION_WEIGHTED_AXES.forEach((axis) => weightedAxisBlocks.get(axis)!.forEach((block, index) => {
    const definition = getFoundationAxisDefinition(axis);
    const axisId = ids[`${axis}AxisId` as keyof typeof ids];
    const folderId = `${rootNodeId}--${axis}-block-${index + 1}`;
    const archiveId = `${folderId}--archive`;
    nodes.push(
      createFoundationFolderNode(
        folderId,
        block.title,
        { x: FOUNDATION_LAYOUT.blockStartX + (index % 2) * FOUNDATION_LAYOUT.blockColumnWidth, y: definition.layoutY + Math.floor(index / 2) * FOUNDATION_LAYOUT.blockRowHeight },
        {
          foundationRole: "block-folder",
          foundationAxis: axis,
          foundationParentId: axisId,
        }
      ),
      createFoundationArchiveNode(
        archiveId,
        `${block.title}档案.md`,
        createBlockArchiveMarkdown(block.title, definition.label, [
          `- 宽度权重：${block.width}`,
          `- 颜色：${block.color}`,
        ], block.content),
        { x: FOUNDATION_LAYOUT.blockStartX + FOUNDATION_LAYOUT.blockArchiveOffsetX + (index % 2) * FOUNDATION_LAYOUT.blockColumnWidth, y: definition.layoutY - 18 + Math.floor(index / 2) * FOUNDATION_LAYOUT.blockRowHeight },
        {
          foundationRole: "block-document",
          foundationAxis: axis,
          foundationParentId: folderId,
        }
      )
    );
    links.push(createFoundationLink(axisId, folderId), createFoundationLink(folderId, archiveId));
  }));

  return { nodes, links };
};

export const createDefaultTimeline = (durationMin = DEFAULT_TIMELINE_DURATION): FoundationScaffold => ({
  id: "film-structure",
  title: "影片时间轴",
  durationMin: normalizeFlowProjectDuration(durationMin),
  head: DEFAULT_TIMELINE_HEAD,
  spaceAxisBlocks: createDefaultSpaceBlocks(),
  axisBlocks: Object.fromEntries(
    FOUNDATION_WEIGHTED_AXES.map((axis) => [axis, createDefaultWeightedAxisBlocks(axis)])
  ) as Partial<Record<FoundationWeightedAxis, FoundationSpaceBlock[]>>,
  blocks: [
    createTimelineBlock(
      "timeline-full",
      "完整时间轴",
      normalizeFlowProjectDuration(durationMin),
      0,
      "amber",
      "这是项目的完整时间范围。按创作需求拆分、命名并调整区块边界。"
    ),
  ],
});

export const createEmptyProjectFlow = (
  durationMin = DEFAULT_TIMELINE_DURATION,
  projectTitle = "项目",
  rootNodeId = `${FOUNDATION_ROOT_NODE_PREFIX}${Date.now().toString(36)}`
): FlowState => {
  const seed = buildFoundationGraphSeed(projectTitle, durationMin, rootNodeId);
  return {
  revision: 0,
  flowNodes: seed.nodes,
  graphLinks: [],
  globalAssetHistory: [],
  linkStyle: "curved",
  activeView: null,
  links: seed.links,
  };
};

export const getFlowProjectDuration = (flow?: FlowState, fallback = DEFAULT_TIMELINE_DURATION) =>
  normalizeFlowProjectDuration(fallback);

export const getFlowProjectsForState = (projectData: ProjectData) => {
  const currentFlow = ensureFlow(projectData.flow);
  if (Array.isArray(projectData.flowProjects) && projectData.flowProjects.length) {
    const activeId = projectData.activeFlowProjectId || projectData.flowProjects[0]?.id;
    return projectData.flowProjects.slice(0, FLOW_PROJECT_LIMIT).map((project) => ({
      ...project,
      rootNodeId: project.rootNodeId || `${FOUNDATION_ROOT_NODE_PREFIX}${project.id}`,
      roles: Array.isArray(project.roles)
        ? project.roles
        : project.id === activeId
          ? projectData.roles || []
          : [],
      designAssets: Array.isArray(project.designAssets)
        ? project.designAssets
        : project.id === activeId
          ? projectData.designAssets || []
          : [],
      rawScript: typeof project.rawScript === "string"
        ? project.rawScript
        : project.id === activeId
          ? projectData.rawScript || ""
          : "",
      episodes: Array.isArray(project.episodes)
        ? project.episodes
        : project.id === activeId
          ? projectData.episodes || []
          : [],
      canvas: project.canvas
        ? project.canvas
        : project.id === activeId
          ? projectData.canvas
          : { viewport: null },
      phase5Usage: project.phase5Usage
        || (project.id === activeId ? projectData.phase5Usage : undefined),
      stats: project.stats
        || (project.id === activeId ? projectData.stats : undefined),
    }));
  }
  const now = Date.now();
  const id = projectData.activeFlowProjectId || "flow-project-main";
  const rootNodeId = `${FOUNDATION_ROOT_NODE_PREFIX}${id}`;
  return [
    {
      id,
      title: projectData.fileName || "主项目",
      color: FLOW_PROJECT_COLOR_STYLES[0].color,
      durationMin: getFlowProjectDuration(currentFlow),
      rootNodeId,
      createdAt: now,
      updatedAt: now,
      roles: projectData.roles || [],
      designAssets: projectData.designAssets || [],
      rawScript: projectData.rawScript || "",
      episodes: projectData.episodes || [],
      canvas: projectData.canvas,
      phase5Usage: projectData.phase5Usage,
      stats: projectData.stats,
      flow: currentFlow.flowNodes?.some((node) => node.id === rootNodeId)
        ? currentFlow
        : createEmptyProjectFlow(DEFAULT_TIMELINE_DURATION, projectData.fileName || "主项目", rootNodeId),
    },
  ];
};

export const saveActiveFlowIntoProjects = (projectData: ProjectData, now = Date.now()) => {
  const activeId = projectData.activeFlowProjectId || projectData.flowProjects?.[0]?.id || "flow-project-main";
  const activeFlow = ensureFlow(projectData.flow);
  const projects = getFlowProjectsForState(projectData);
  return projects.map((project) =>
    project.id === activeId
      ? {
          ...project,
          durationMin: getFlowProjectDuration(activeFlow, project.durationMin),
          updatedAt: now,
          rootNodeId: project.rootNodeId || `${FOUNDATION_ROOT_NODE_PREFIX}${project.id}`,
          roles: projectData.roles || [],
          designAssets: projectData.designAssets || [],
          rawScript: projectData.rawScript || "",
          episodes: projectData.episodes || [],
          canvas: projectData.canvas,
          phase5Usage: projectData.phase5Usage,
          stats: projectData.stats,
          flow: activeFlow,
        }
      : project
  );
};

export const ensureTimeline = (timeline?: FoundationScaffold): FoundationScaffold => {
  if (!timeline || !Array.isArray(timeline.blocks) || !timeline.blocks.length) return createDefaultTimeline();
  const durationMin = normalizeFlowProjectDuration(timeline.durationMin);
  const head = timeline.head || DEFAULT_TIMELINE_HEAD;
  return {
    id: timeline.id || "film-structure",
    title: timeline.title || "影片时间轴",
    durationMin,
    head: {
      title: head.title || DEFAULT_TIMELINE_HEAD.title,
      content: head.content || "",
    },
    spaceAxisBlocks: getWeightedAxisBlocks(timeline, "space"),
    axisBlocks: Object.fromEntries(
      FOUNDATION_WEIGHTED_AXES.map((axis) => [axis, getWeightedAxisBlocks(timeline, axis)])
    ) as Partial<Record<FoundationWeightedAxis, FoundationSpaceBlock[]>>,
    blocks: recalculateTimelineBlocks(
      timeline.blocks.map((block, index) => ({
        id: block.id || `timeline-block-${index + 1}`,
        title: block.title || `时间区块 ${index + 1}`,
        content: block.content || "",
        startMin: Number(block.startMin) || 0,
        durationMin: Math.max(MIN_TIMELINE_BLOCK_MINUTES, Math.round(Number(block.durationMin) || 12)),
        color: block.color || TIMELINE_COLORS[index % TIMELINE_COLORS.length].value,
        order: Number.isFinite(block.order) ? block.order : index,
        boundaryNodeIds: Array.isArray(block.boundaryNodeIds) ? block.boundaryNodeIds : [],
      })),
      durationMin
    ),
  };
};

export const formatTimelineTime = (minute: number) => {
  const safe = Math.max(0, Math.round(minute));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
};

export const buildTimelineMarkdown = (timeline: FoundationScaffold) => {
  const weightedAxes = FOUNDATION_WEIGHTED_AXES.map((axis) => ({
    axis,
    definition: getFoundationAxisDefinition(axis),
    blocks: getWeightedAxisBlocks(timeline, axis),
  }));
  const head = timeline.head || DEFAULT_TIMELINE_HEAD;
  const boundaryConnectionCount =
    weightedAxes.reduce(
      (sum, entry) => sum + entry.blocks.reduce((axisSum, block) => axisSum + block.boundaryNodeIds.length, 0),
      0
    ) +
    timeline.blocks.reduce((sum, block) => sum + block.boundaryNodeIds.length, 0);

  return [
    `# 项目`,
    "",
    `- 根：${head.title}`,
    `- 总时长：${timeline.durationMin} min`,
    ...weightedAxes.map((entry) => `- ${entry.definition.label}区块：${entry.blocks.length}`),
    `- 时间区块：${timeline.blocks.length}`,
    `- 块边界连接：${boundaryConnectionCount}`,
    "",
    `## ${head.title} / 全局层`,
    "",
    ...weightedAxes.flatMap((entry) => [
      `## ${entry.definition.label}`,
      "",
      ...entry.blocks.flatMap((block) => [
        `### ${block.title}`,
        "",
        `- 边界连接：${block.boundaryNodeIds.length}`,
        "",
      ]),
    ]),
    `## 时间轴`,
    "",
    ...timeline.blocks.flatMap((block) => [
      `### ${formatTimelineTime(block.startMin)}-${formatTimelineTime(block.startMin + block.durationMin)} ${block.title}`,
      "",
      `- 边界连接：${block.boundaryNodeIds.length}`,
      "",
    ]),
  ].join("\n");
};

export const compactMarkdownPreview = (content: string) => {
  const clean = content.replace(/\s+/g, " ").trim();
  if (!clean) return "写下角色、场景、风格、规格或任何全局档案。";
  return clean.length > 180 ? `${clean.slice(0, 180)}...` : clean;
};

export type ParsedFoundationBlock = FoundationTimeBlock & {
  archiveNodeId?: string;
};

export type ParsedFoundationSpaceBlock = FoundationSpaceBlock & {
  archiveNodeId?: string;
};

export type ParsedFoundationGraph = {
  rootNodeId: string;
  axisNodeIds: Record<FoundationAxis, string>;
  timeAxisNodeId: string;
  spaceAxisNodeId: string;
  headArchiveNodeId?: string;
  timeline: FoundationScaffold;
};

const getNodeTitle = (node?: NodeFlowNode | null) => {
  const data = (node?.data || {}) as { title?: string; label?: string; filename?: string };
  return data.title?.trim() || data.label?.trim() || data.filename?.trim() || node?.id || "";
};

const getFoundationNodeMeta = (node?: NodeFlowNode | null) =>
  (node?.data || {}) as Partial<FoundationNodeMeta>;

export const getFoundationNodeRole = (node?: NodeFlowNode | null) =>
  getFoundationNodeMeta(node).foundationRole;

export const isFoundationStructuralNode = (node?: NodeFlowNode | null) =>
  Boolean(getFoundationNodeMeta(node).foundationRole);

export const isFoundationStructuralLink = (
  flow: Pick<FlowState, "flowNodes">,
  link: FlowState["links"][number]
) => {
  const target = (flow.flowNodes || []).find((node) => node.id === link.target);
  const meta = getFoundationNodeMeta(target);
  return Boolean(meta.foundationRole && meta.foundationParentId === link.source);
};

const getMarkdownContent = (node?: NodeFlowNode | null) => {
  const data = (node?.data || {}) as { text?: string; content?: string };
  return typeof data.content === "string" ? data.content : data.text || "";
};

const parseMarkdownNumber = (content: string, label: string, fallback: number) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`${escaped}\\s*[：:]\\s*([0-9.]+)`));
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) ? value : fallback;
};

const parseMarkdownColor = (content: string, fallback = "slate") => {
  const match = content.match(/颜色\s*[：:]\s*([A-Za-z0-9_-]+)/);
  return match?.[1] || fallback;
};

const parseMarkdownUserContent = (content: string) => {
  const marker = "## 用户记录";
  const index = content.indexOf(marker);
  if (index < 0) return content.replace(/^# .+?\n+/, "").trim();
  return content.slice(index + marker.length).trim() || "";
};

const getFoundationOrder = (node: NodeFlowNode) => {
  const order = getFoundationNodeMeta(node).foundationOrder;
  return typeof order === "number" && Number.isFinite(order) ? order : null;
};

const sortFoundationChildren = (items: NodeFlowNode[]) =>
  items.slice().sort((a, b) => {
    const aOrder = getFoundationOrder(a);
    const bOrder = getFoundationOrder(b);
    if (aOrder != null || bOrder != null) return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
    return (a.position?.y || 0) - (b.position?.y || 0) || (a.position?.x || 0) - (b.position?.x || 0);
  });

const getOutgoingTargets = (links: FlowState["links"], sourceId: string) =>
  links.filter((link) => link.source === sourceId).map((link) => link.target);

const findFirstArchiveChild = (
  nodeById: Map<string, NodeFlowNode>,
  links: FlowState["links"],
  folderId: string
) => {
  const children = getOutgoingTargets(links, folderId)
    .map((id) => nodeById.get(id))
    .filter((node): node is NodeFlowNode => node?.type === "mdText");
  const structuralArchive = children.find(
    (node) =>
      getFoundationNodeMeta(node).foundationRole === "block-document" ||
      node.id === `${folderId}--archive`
  );
  return structuralArchive || null;
};

const buildFoundationMarkdownIndex = (
  projectTitle: string,
  timeline: FoundationScaffold,
  nodeById: Map<string, NodeFlowNode>
) => [
  "# 项目索引",
  "",
  `- 项目：${projectTitle}`,
  `- 预估时长：${timeline.durationMin} min`,
  `- 文件夹解析深度：${FOUNDATION_PROJECT_INDEX_DEPTH}`,
  "",
  "## 时间轴",
  "",
  ...timeline.blocks.flatMap((block) => {
    const archiveNodeId = (block as ParsedFoundationBlock).archiveNodeId;
    const archiveTitle = archiveNodeId ? getNodeTitle(nodeById.get(archiveNodeId)) : "未生成块文档";
    const relatedTitles = block.boundaryNodeIds
      .map((nodeId) => getNodeTitle(nodeById.get(nodeId)))
      .filter(Boolean);
    return [
      `- ${formatTimelineTime(block.startMin)}-${formatTimelineTime(block.startMin + block.durationMin)} ${block.title}`,
      `  - 块文档：${archiveTitle}`,
      `  - 其它连接：${relatedTitles.length ? relatedTitles.join("、") : "无"}`,
    ];
  }),
  ...FOUNDATION_WEIGHTED_AXES.flatMap((axis) => [
    "",
    `## ${getFoundationAxisDefinition(axis).label}`,
    "",
    ...getWeightedAxisBlocks(timeline, axis).flatMap((block) => {
      const archiveNodeId = (block as ParsedFoundationSpaceBlock).archiveNodeId;
      const archiveTitle = archiveNodeId ? getNodeTitle(nodeById.get(archiveNodeId)) : "未生成块文档";
      const relatedTitles = block.boundaryNodeIds
        .map((nodeId) => getNodeTitle(nodeById.get(nodeId)))
        .filter(Boolean);
      return [
        `- ${block.title}`,
        `  - 块文档：${archiveTitle}`,
        `  - 归属节点：${relatedTitles.length ? relatedTitles.join("、") : "无"}`,
      ];
    }),
  ]),
].join("\n");

export const parseFoundationGraph = (
  flow: FlowState,
  project: Pick<FlowProject, "rootNodeId" | "title" | "durationMin">
): ParsedFoundationGraph => {
  const flowNodes = flow.flowNodes || [];
  const nodeById = new Map(flowNodes.map((node) => [node.id, node]));
  const rootNode = nodeById.get(project.rootNodeId);
  if (!rootNode) {
    return {
      rootNodeId: project.rootNodeId,
      axisNodeIds: { time: "", space: "", character: "", scene: "" },
      timeAxisNodeId: "",
      spaceAxisNodeId: "",
      timeline: createDefaultTimeline(project.durationMin),
    };
  }

  const rootChildren = getOutgoingTargets(flow.links, rootNode.id)
    .map((id) => nodeById.get(id))
    .filter((node): node is NodeFlowNode => Boolean(node));
  const childFolders = rootChildren.filter((node) => node.type === "folder");
  const axisNodes = Object.fromEntries(
    FOUNDATION_AXES.map((axis) => {
      const definition = getFoundationAxisDefinition(axis);
      const node = childFolders.find(
        (item) =>
          getFoundationNodeMeta(item).foundationAxis === axis ||
          item.id.endsWith(`--${axis}-axis`) ||
          getNodeTitle(item).includes(definition.label.replace(/轴$/, ""))
      );
      return [axis, node];
    })
  ) as Record<FoundationAxis, NodeFlowNode | undefined>;
  const timeAxis = axisNodes.time || childFolders[0];
  const spaceAxis = axisNodes.space || childFolders.find((node) => node.id !== timeAxis?.id) || childFolders[1];
  axisNodes.time = timeAxis;
  axisNodes.space = spaceAxis;
  const projectIndex = rootChildren.find(
    (node) => node.type === "mdText" && getFoundationNodeMeta(node).foundationRole === "project-index"
  ) || rootChildren.find((node) => node.type === "mdText");

  const parseTimeBlocks = (axisId?: string): ParsedFoundationBlock[] => {
    if (!axisId) return createDefaultTimeline(project.durationMin).blocks;
    const folderChildren = sortFoundationChildren(
      getOutgoingTargets(flow.links, axisId)
        .map((id) => nodeById.get(id))
        .filter((node): node is NodeFlowNode => node?.type === "folder")
    );
    if (!folderChildren.length) return createDefaultTimeline(project.durationMin).blocks;
    const blocks = folderChildren.map((folder, index) => {
      const archive = findFirstArchiveChild(nodeById, flow.links, folder.id);
      const content = getMarkdownContent(archive);
      return {
        id: folder.id,
        title: getNodeTitle(folder) || `时间区块 ${index + 1}`,
        content: parseMarkdownUserContent(content),
        startMin: 0,
        durationMin: Math.max(MIN_TIMELINE_BLOCK_MINUTES, Math.round(parseMarkdownNumber(content, "时长", 12))),
        color: parseMarkdownColor(content, TIMELINE_COLORS[index % TIMELINE_COLORS.length].value),
        order: index,
        boundaryNodeIds: getOutgoingTargets(flow.links, folder.id).filter((id) => id !== archive?.id && nodeById.get(id)?.type !== "folder"),
        archiveNodeId: archive?.id,
      };
    });
    return recalculateTimelineBlocks(blocks, normalizeFlowProjectDuration(project.durationMin)) as ParsedFoundationBlock[];
  };

  const parseWeightedBlocks = (axis: FoundationWeightedAxis, axisId?: string): ParsedFoundationSpaceBlock[] => {
    if (!axisId) return createDefaultWeightedAxisBlocks(axis);
    const folderChildren = sortFoundationChildren(
      getOutgoingTargets(flow.links, axisId)
        .map((id) => nodeById.get(id))
        .filter((node): node is NodeFlowNode => node?.type === "folder")
    );
    if (!folderChildren.length) return createDefaultWeightedAxisBlocks(axis);
    const definition = getFoundationAxisDefinition(axis);
    return folderChildren.map((folder, index) => {
      const archive = findFirstArchiveChild(nodeById, flow.links, folder.id);
      const content = getMarkdownContent(archive);
      return {
        id: folder.id,
        title: getNodeTitle(folder) || `${definition.blockLabel} ${index + 1}`,
        content: parseMarkdownUserContent(content),
        color: parseMarkdownColor(content, TIMELINE_COLORS[index % TIMELINE_COLORS.length].value),
        order: index,
        width: Math.max(0.45, parseMarkdownNumber(content, "宽度权重", 1)),
        boundaryNodeIds: getOutgoingTargets(flow.links, folder.id).filter((id) => id !== archive?.id && nodeById.get(id)?.type !== "folder"),
        archiveNodeId: archive?.id,
      };
    });
  };

  const timeBlocks = parseTimeBlocks(timeAxis?.id);
  const axisBlocks = Object.fromEntries(
    FOUNDATION_WEIGHTED_AXES.map((axis) => [axis, parseWeightedBlocks(axis, axisNodes[axis]?.id)])
  ) as Partial<Record<FoundationWeightedAxis, FoundationSpaceBlock[]>>;
  const spaceAxisBlocks = axisBlocks.space;
  const timeline: FoundationScaffold = {
    id: "foundation-view",
    title: getNodeTitle(timeAxis) || "时间轴",
    durationMin: normalizeFlowProjectDuration(project.durationMin),
    head: {
      title: getNodeTitle(projectIndex) || "项目索引.md",
      content: getMarkdownContent(projectIndex),
    },
    spaceAxisBlocks,
    axisBlocks,
    blocks: timeBlocks,
  };

  return {
    rootNodeId: rootNode.id,
    axisNodeIds: Object.fromEntries(
      FOUNDATION_AXES.map((axis) => [axis, axisNodes[axis]?.id || ""])
    ) as Record<FoundationAxis, string>,
    timeAxisNodeId: timeAxis?.id || "",
    spaceAxisNodeId: spaceAxis?.id || "",
    headArchiveNodeId: projectIndex?.id,
    timeline,
  };
};

const hasFoundationMeta = (node: NodeFlowNode, meta: FoundationNodeMeta) => {
  const current = getFoundationNodeMeta(node);
  return (
    current.foundationRole === meta.foundationRole &&
    current.foundationAxis === meta.foundationAxis &&
    current.foundationParentId === meta.foundationParentId &&
    current.locked === true &&
    Boolean(current.readOnly) === Boolean(meta.readOnly) &&
    node.deletable === false &&
    node.connectable === (meta.foundationRole === "block-folder")
  );
};

const applyFoundationMeta = (
  node: NodeFlowNode,
  meta: FoundationNodeMeta,
  title?: string
): NodeFlowNode => {
  const currentTitle = getNodeTitle(node);
  if (hasFoundationMeta(node, meta) && (!title || currentTitle === title)) return node;
  return {
    ...node,
    deletable: false,
    connectable: meta.foundationRole === "block-folder",
    data: {
      ...node.data,
      ...(title ? { title } : {}),
      foundationRole: meta.foundationRole,
      foundationAxis: meta.foundationAxis,
      foundationParentId: meta.foundationParentId,
      locked: true,
      readOnly: Boolean(meta.readOnly),
    } as NodeFlowNodeData,
  };
};

const sameFoundationLink = (
  left: FlowState["links"][number],
  right: FlowState["links"][number]
) => left.source === right.source && left.target === right.target;

export const ensureFoundationGraphSkeleton = (
  flow: FlowState,
  project: Pick<FlowProject, "rootNodeId" | "title" | "durationMin">
): FlowState => {
  const isPristineInitialization =
    (flow.revision || 0) === 0 &&
    (flow.flowNodes?.length || 0) === 0 &&
    flow.links.length === 0 &&
    (flow.graphLinks?.length || 0) === 0 &&
    (flow.globalAssetHistory?.length || 0) === 0;
  const seed = buildFoundationGraphSeed(project.title, project.durationMin, project.rootNodeId);
  const legacyAxisIndexIds = getLegacyAxisIndexIds(project.rootNodeId);
  let changed = false;
  const nodes = (flow.flowNodes || []).filter((node) => {
    const keep = !legacyAxisIndexIds.has(node.id);
    if (!keep) changed = true;
    return keep;
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const ids = getFoundationSeedIds(project.rootNodeId);
  const axisHasBlock = Object.fromEntries(
    FOUNDATION_AXES.map((axis) => {
      const axisId = ids[`${axis}AxisId` as keyof typeof ids];
      return [axis, flow.links.some((link) => link.source === axisId && nodeById.get(link.target)?.type === "folder")];
    })
  ) as Record<FoundationAxis, boolean>;
  const seedNodesToEnsure = seed.nodes.filter((template) => {
    const meta = getFoundationNodeMeta(template);
    if (meta.foundationRole !== "block-folder" && meta.foundationRole !== "block-document") return true;
    return meta.foundationAxis ? !axisHasBlock[meta.foundationAxis] : true;
  });
  const seedNodeIdsToEnsure = new Set(seedNodesToEnsure.map((node) => node.id));

  seedNodesToEnsure.forEach((template) => {
    const existing = nodeById.get(template.id);
    if (!existing) {
      nodes.push(template);
      nodeById.set(template.id, template);
      changed = true;
      return;
    }
    const templateMeta = getFoundationNodeMeta(template) as FoundationNodeMeta;
    const next = applyFoundationMeta(existing, templateMeta, getNodeTitle(template));
    if (next !== existing) {
      const index = nodes.findIndex((node) => node.id === existing.id);
      nodes[index] = next;
      nodeById.set(next.id, next);
      changed = true;
    }
  });

  const axisById = new Map<string, FoundationAxis>(
    FOUNDATION_AXES.map((axis) => [ids[`${axis}AxisId` as keyof typeof ids], axis])
  );
  const rootTargets = new Set([ids.projectIndexId, ...axisById.keys()]);
  let links = flow.links.filter((link) => {
    if (legacyAxisIndexIds.has(link.source) || legacyAxisIndexIds.has(link.target)) {
      changed = true;
      return false;
    }
    if (link.source === project.rootNodeId && !rootTargets.has(link.target)) {
      changed = true;
      return false;
    }
    const axis = axisById.get(link.source);
    if (axis && nodeById.get(link.target)?.type !== "folder") {
      changed = true;
      return false;
    }
    return true;
  });

  seed.links
    .filter((link) => seedNodeIdsToEnsure.has(link.source) && seedNodeIdsToEnsure.has(link.target))
    .forEach((requiredLink) => {
      if (links.some((link) => sameFoundationLink(link, requiredLink))) return;
      links.push(requiredLink);
      changed = true;
    });

  axisById.forEach((axis, axisId) => {
    const blockIds = Array.from(
      new Set(links.filter((link) => link.source === axisId).map((link) => link.target))
    );
    blockIds.forEach((blockId, blockIndex) => {
      const block = nodeById.get(blockId);
      if (!block || block.type !== "folder") return;
      const nextBlock = applyFoundationMeta(block, {
        foundationRole: "block-folder",
        foundationAxis: axis,
        foundationParentId: axisId,
      });
      if (nextBlock !== block) {
        const index = nodes.findIndex((node) => node.id === block.id);
        nodes[index] = nextBlock;
        nodeById.set(block.id, nextBlock);
        changed = true;
      }

      const archive = findFirstArchiveChild(nodeById, links, blockId);
      if (archive) {
        const nextArchive = applyFoundationMeta(archive, {
          foundationRole: "block-document",
          foundationAxis: axis,
          foundationParentId: blockId,
        });
        if (nextArchive !== archive) {
          const index = nodes.findIndex((node) => node.id === archive.id);
          nodes[index] = nextArchive;
          nodeById.set(archive.id, nextArchive);
          changed = true;
        }
        return;
      }

      const archiveId = `${blockId}--archive`;
      const isTime = axis === "time";
      const content = createBlockArchiveMarkdown(
        getNodeTitle(block),
        getFoundationAxisDefinition(axis).label,
        isTime
          ? ["- 起点：0 min", "- 时长：12 min", `- 颜色：${TIMELINE_COLORS[blockIndex % TIMELINE_COLORS.length].value}`]
          : ["- 宽度权重：1", `- 颜色：${TIMELINE_COLORS[blockIndex % TIMELINE_COLORS.length].value}`],
        ""
      );
      const archiveNode = createFoundationArchiveNode(
        archiveId,
        `${getNodeTitle(block)}档案.md`,
        content,
        {
          x: (block.position?.x || FOUNDATION_LAYOUT.blockStartX) + FOUNDATION_LAYOUT.blockArchiveOffsetX,
          y: (block.position?.y || getFoundationAxisDefinition(axis).layoutY) - 18,
        },
        {
          foundationRole: "block-document",
          foundationAxis: axis,
          foundationParentId: blockId,
        }
      );
      nodes.push(archiveNode);
      nodeById.set(archiveNode.id, archiveNode);
      links.push(createFoundationLink(blockId, archiveId));
      changed = true;
    });
  });

  links = links.filter((link) => {
    const source = nodeById.get(link.source);
    const target = nodeById.get(link.target);
    if (!source || !target) {
      changed = true;
      return false;
    }
    const sourceMeta = getFoundationNodeMeta(source);
    const targetMeta = getFoundationNodeMeta(target);
    if (targetMeta.foundationRole === "project-root") {
      changed = true;
      return false;
    }
    if (
      sourceMeta.foundationRole === "project-index" ||
      sourceMeta.foundationRole === "block-document"
    ) {
      changed = true;
      return false;
    }
    if (
      targetMeta.foundationRole &&
      targetMeta.foundationParentId &&
      targetMeta.foundationParentId !== link.source
    ) {
      changed = true;
      return false;
    }
    return true;
  });

  const seenRelations = new Set<string>();
  links = links.filter((link) => {
    const relation = `${link.source}\u0000${link.target}`;
    if (seenRelations.has(relation)) {
      changed = true;
      return false;
    }
    seenRelations.add(relation);
    return true;
  });

  let normalizedFlow: FlowState = {
    ...flow,
    flowNodes: nodes,
    links,
  };
  const membershipNormalizedFlow = normalizeFoundationMemberships(normalizedFlow);
  if (membershipNormalizedFlow !== normalizedFlow) {
    normalizedFlow = membershipNormalizedFlow;
    links = normalizedFlow.links;
    (normalizedFlow.flowNodes ?? []).forEach((node) => nodeById.set(node.id, node));
    changed = true;
  }
  const parsed = parseFoundationGraph(normalizedFlow, project);
  const projectIndexContent = buildFoundationMarkdownIndex(
    project.title,
    parsed.timeline,
    nodeById
  );
  const projectIndex = nodeById.get(ids.projectIndexId);
  if (projectIndex) {
    const data = projectIndex.data as NodeFlowNodeData & { text?: string; content?: string; preview?: string };
    if (data.content !== projectIndexContent || data.text !== projectIndexContent) {
      const nextProjectIndex: NodeFlowNode = {
        ...projectIndex,
        data: {
          ...projectIndex.data,
          text: projectIndexContent,
          content: projectIndexContent,
          preview: compactMarkdownPreview(projectIndexContent),
        } as NodeFlowNodeData,
      };
      const index = nodes.findIndex((node) => node.id === projectIndex.id);
      nodes[index] = nextProjectIndex;
      nodeById.set(projectIndex.id, nextProjectIndex);
      changed = true;
    }
  }

  if (!changed) return flow;
  const finalFlow = normalizeFoundationMemberships({
    ...normalizedFlow,
    flowNodes: nodes,
    links,
  });
  return {
    ...finalFlow,
    revision: isPristineInitialization ? 0 : (flow.revision || 0) + 1,
  };
};

export const getFoundationScaffoldNodeIds = (
  flow: FlowState,
  project: Pick<FlowProject, "rootNodeId" | "title" | "durationMin">
) => {
  const parsed = parseFoundationGraph(flow, project);
  const nodeById = new Map((flow.flowNodes || []).map((node) => [node.id, node]));
  const ids = new Set<string>();
  if (parsed.rootNodeId) ids.add(parsed.rootNodeId);
  FOUNDATION_AXES.forEach((axis) => {
    if (parsed.axisNodeIds[axis]) ids.add(parsed.axisNodeIds[axis]);
  });
  if (parsed.headArchiveNodeId) ids.add(parsed.headArchiveNodeId);

  parsed.timeline.blocks.forEach((block) => {
    ids.add(block.id);
    const archiveNodeId = (block as ParsedFoundationBlock).archiveNodeId;
    if (archiveNodeId) ids.add(archiveNodeId);
  });
  FOUNDATION_WEIGHTED_AXES.forEach((axis) => {
    getWeightedAxisBlocks(parsed.timeline, axis).forEach((block) => {
      ids.add(block.id);
      const archiveNodeId = (block as ParsedFoundationSpaceBlock).archiveNodeId;
      if (archiveNodeId) ids.add(archiveNodeId);
    });
  });
  return ids;
};

export const layoutFoundationGraph = (
  flow: FlowState,
  project: Pick<FlowProject, "rootNodeId" | "title" | "durationMin">
): FlowState => {
  const parsed = parseFoundationGraph(flow, project);
  const nodeById = new Map((flow.flowNodes || []).map((node) => [node.id, node]));
  const positionById = new Map<string, { x: number; y: number }>([
    [parsed.rootNodeId, FOUNDATION_LAYOUT.root],
    ...(parsed.headArchiveNodeId ? [[parsed.headArchiveNodeId, FOUNDATION_LAYOUT.projectIndex] as const] : []),
    ...FOUNDATION_AXES.flatMap((axis) => {
      const axisNodeId = parsed.axisNodeIds[axis];
      return axisNodeId ? [[axisNodeId, FOUNDATION_AXIS_POSITIONS[axis]] as const] : [];
    }),
  ]);

  FOUNDATION_AXES.forEach((axis) => {
    const blocks = axis === "time" ? parsed.timeline.blocks : getWeightedAxisBlocks(parsed.timeline, axis);
    const layoutY = getFoundationAxisDefinition(axis).layoutY;
    blocks.forEach((block, index) => {
      const x = FOUNDATION_LAYOUT.blockStartX + (index % 2) * FOUNDATION_LAYOUT.blockColumnWidth;
      const y = layoutY + Math.floor(index / 2) * FOUNDATION_LAYOUT.blockRowHeight;
      positionById.set(block.id, { x, y });
      const archiveNodeId = (block as ParsedFoundationBlock | ParsedFoundationSpaceBlock).archiveNodeId;
      if (archiveNodeId) positionById.set(archiveNodeId, { x: x + FOUNDATION_LAYOUT.blockArchiveOffsetX, y: y - 18 });
    });
  });

  const projectIndexContent = buildFoundationMarkdownIndex(
    project.title,
    parsed.timeline,
    nodeById
  );

  return {
    ...flow,
    revision: (flow.revision || 0) + 1,
    flowNodes: (flow.flowNodes || []).map((node) => {
      const nextPosition = positionById.get(node.id);
      const content =
        node.id === parsed.headArchiveNodeId
          ? projectIndexContent
          : null;
      return {
        ...node,
        ...(nextPosition ? { position: nextPosition } : {}),
        data: content === null
          ? node.data
          : {
              ...node.data,
              text: content,
              content,
              preview: compactMarkdownPreview(content),
            },
      };
    }),
  };
};

export const applyFoundationTimelineToGraph = (
  flow: FlowState,
  project: Pick<FlowProject, "rootNodeId" | "title" | "durationMin">,
  nextTimeline: FoundationScaffold
): FlowState => {
  const parsed = parseFoundationGraph(flow, project);
  const nodeById = new Map((flow.flowNodes || []).map((node) => [node.id, node]));
  const currentBlocksByAxis = Object.fromEntries(
    FOUNDATION_AXES.map((axis) => [
      axis,
      axis === "time" ? parsed.timeline.blocks : getWeightedAxisBlocks(parsed.timeline, axis),
    ])
  ) as Record<FoundationAxis, Array<FoundationTimeBlock | FoundationSpaceBlock>>;
  const nextBlocksByAxis = Object.fromEntries(
    FOUNDATION_AXES.map((axis) => [
      axis,
      axis === "time" ? nextTimeline.blocks : getWeightedAxisBlocks(nextTimeline, axis),
    ])
  ) as Record<FoundationAxis, Array<FoundationTimeBlock | FoundationSpaceBlock>>;
  const removedIds = new Set<string>();
  FOUNDATION_AXES.forEach((axis) => {
    const nextIds = new Set(nextBlocksByAxis[axis].map((block) => block.id));
    currentBlocksByAxis[axis].forEach((block) => {
      if (!nextIds.has(block.id)) removedIds.add(block.id);
    });
  });

  const removedArchiveIds = new Set<string>();
  removedIds.forEach((id) => {
    const archive = findFirstArchiveChild(nodeById, flow.links, id);
    if (archive) removedArchiveIds.add(archive.id);
  });

  const nextNodes = (flow.flowNodes || [])
    .filter((node) => !removedIds.has(node.id) && !removedArchiveIds.has(node.id))
    .map((node) => {
      const blockEntry = FOUNDATION_AXES.map((axis) => ({
        axis,
        block: nextBlocksByAxis[axis].find((block) => block.id === node.id),
        index: nextBlocksByAxis[axis].findIndex((block) => block.id === node.id),
      })).find((entry) => entry.block);
      if (blockEntry?.block) {
        const layoutY = getFoundationAxisDefinition(blockEntry.axis).layoutY;
        const orderedPosition = {
          x: FOUNDATION_LAYOUT.blockStartX + (blockEntry.index % 2) * FOUNDATION_LAYOUT.blockColumnWidth,
          y: layoutY + Math.floor(blockEntry.index / 2) * FOUNDATION_LAYOUT.blockRowHeight,
        };
        return {
          ...node,
          position: orderedPosition,
          data: {
            ...node.data,
            title: blockEntry.block.title || getNodeTitle(node),
          },
        };
      }
      const nodeMeta = getFoundationNodeMeta(node);
      const parentLink = flow.links.find(
        (link) =>
          link.target === node.id &&
          (nodeMeta.foundationRole === "block-document" || node.id === `${link.source}--archive`)
      );
      const parentBlockId = parentLink?.source || "";
      const parentEntry = FOUNDATION_AXES.map((axis) => ({
        axis,
        block: nextBlocksByAxis[axis].find((block) => block.id === parentBlockId),
      })).find((entry) => entry.block);
      if (node.type === "mdText" && parentEntry?.block && parentLink) {
        const fields = parentEntry.axis === "time"
          ? [
              `- 起点：${(parentEntry.block as FoundationTimeBlock).startMin} min`,
              `- 时长：${(parentEntry.block as FoundationTimeBlock).durationMin} min`,
              `- 颜色：${parentEntry.block.color}`,
            ]
          : [
              `- 宽度权重：${(parentEntry.block as FoundationSpaceBlock).width}`,
              `- 颜色：${parentEntry.block.color}`,
            ];
        const content = createBlockArchiveMarkdown(
          parentEntry.block.title,
          getFoundationAxisDefinition(parentEntry.axis).label,
          fields,
          parentEntry.block.content
        );
        return {
          ...node,
          data: {
            ...node.data,
            title: `${parentEntry.block.title}档案.md`,
            text: content,
            content,
            preview: compactMarkdownPreview(content),
          },
        };
      }
      return node;
    });

  const nextLinks = flow.links.filter(
    (link) =>
      !removedIds.has(link.source) &&
      !removedIds.has(link.target) &&
      !removedArchiveIds.has(link.source) &&
      !removedArchiveIds.has(link.target)
  );
  const existingNodeIds = new Set(nextNodes.map((node) => node.id));
  const existingLinkIds = new Set(nextLinks.map((link) => link.id));
  const addNode = (node: NodeFlowNode) => {
    if (!existingNodeIds.has(node.id)) {
      nextNodes.push(node);
      existingNodeIds.add(node.id);
    }
  };
  const addLink = (link: FlowState["links"][number]) => {
    if (!existingLinkIds.has(link.id)) {
      nextLinks.push(link);
      existingLinkIds.add(link.id);
    }
  };

  FOUNDATION_AXES.forEach((axis) => {
    const currentIds = new Set(currentBlocksByAxis[axis].map((block) => block.id));
    const definition = getFoundationAxisDefinition(axis);
    nextBlocksByAxis[axis].forEach((block, index) => {
      if (!currentIds.has(block.id)) {
        const archiveId = `${block.id}--archive`;
        const x = FOUNDATION_LAYOUT.blockStartX + (index % 2) * FOUNDATION_LAYOUT.blockColumnWidth;
        const y = definition.layoutY + Math.floor(index / 2) * FOUNDATION_LAYOUT.blockRowHeight;
        const fields = axis === "time"
          ? [
              `- 起点：${(block as FoundationTimeBlock).startMin} min`,
              `- 时长：${(block as FoundationTimeBlock).durationMin} min`,
              `- 颜色：${block.color}`,
            ]
          : [`- 宽度权重：${(block as FoundationSpaceBlock).width}`, `- 颜色：${block.color}`];
        addNode(createFoundationFolderNode(block.id, block.title, { x, y }, {
          foundationRole: "block-folder",
          foundationAxis: axis,
          foundationParentId: parsed.axisNodeIds[axis],
        }));
        addNode(createFoundationArchiveNode(
          archiveId,
          `${block.title}档案.md`,
          createBlockArchiveMarkdown(block.title, definition.label, fields, block.content),
          { x: x + FOUNDATION_LAYOUT.blockArchiveOffsetX, y: y - 18 },
          {
            foundationRole: "block-document",
            foundationAxis: axis,
            foundationParentId: block.id,
          }
        ));
        if (parsed.axisNodeIds[axis]) addLink(createFoundationLink(parsed.axisNodeIds[axis], block.id));
        addLink(createFoundationLink(block.id, archiveId));
      }
      block.boundaryNodeIds.forEach((targetNodeId) => {
        if (existingNodeIds.has(targetNodeId)) addLink(createFoundationMembershipLink(block.id, targetNodeId));
      });
    });
  });

  const normalizedMembershipFlow = normalizeFoundationMemberships({
    ...flow,
    revision: (flow.revision || 0) + 1,
    flowNodes: nextNodes,
    links: nextLinks,
  });
  return layoutFoundationGraph(
    normalizedMembershipFlow,
    project
  );
};
