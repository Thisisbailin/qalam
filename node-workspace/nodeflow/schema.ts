import { z } from "zod";
import { NODE_TYPES, type NodeFlowFile } from "../types";

export const NODE_FLOW_IMPORT_LIMITS = {
  jsonBytes: 25 * 1024 * 1024,
  nodes: 2_000,
  links: 5_000,
  graphLinks: 5_000,
  globalAssets: 5_000,
} as const;

const finiteCoordinate = z.number().finite().min(-1_000_000_000).max(1_000_000_000);
const nonEmptyId = z.string().trim().min(1).max(256);
const unknownRecord = z.record(z.string(), z.unknown());

const nodeSchema = z.object({
  id: nonEmptyId,
  type: z.enum(NODE_TYPES),
  position: z.object({ x: finiteCoordinate, y: finiteCoordinate }),
  data: unknownRecord,
  parentId: nonEmptyId.optional(),
  extent: z.literal("parent").optional(),
  style: unknownRecord.optional(),
  measured: z.object({
    width: z.number().finite().nonnegative().optional(),
    height: z.number().finite().nonnegative().optional(),
  }).optional(),
  selected: z.boolean().optional(),
  deletable: z.boolean().optional(),
  draggable: z.boolean().optional(),
  connectable: z.boolean().optional(),
}).passthrough();

const linkSchema = z.object({
  id: z.string().trim().max(512).optional(),
  source: nonEmptyId,
  target: nonEmptyId,
  sourceHandle: z.string().max(128).nullable().optional(),
  targetHandle: z.string().max(128).nullable().optional(),
  data: unknownRecord.optional(),
  selected: z.boolean().optional(),
  type: z.string().max(128).optional(),
  markerEnd: z.string().max(256).optional(),
}).passthrough();

const graphLinkSchema = z.object({
  id: nonEmptyId,
  sourceRef: nonEmptyId,
  targetRef: nonEmptyId,
});

const globalAssetSchema = z.object({
  id: nonEmptyId,
  type: z.enum(["image", "video", "audio"]),
  src: z.string().max(NODE_FLOW_IMPORT_LIMITS.jsonBytes),
  prompt: z.string().max(100_000),
  aspectRatio: z.string().max(64).optional(),
  model: z.string().max(256).optional(),
  timestamp: z.number().finite(),
  sourceId: z.string().max(256).optional(),
});

const nodeFlowSchema = z.object({
  version: z.literal(2),
  revision: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(256),
  nodes: z.array(nodeSchema).max(NODE_FLOW_IMPORT_LIMITS.nodes),
  links: z.array(linkSchema).max(NODE_FLOW_IMPORT_LIMITS.links),
  graphLinks: z.array(graphLinkSchema).max(NODE_FLOW_IMPORT_LIMITS.graphLinks).optional(),
  linkStyle: z.enum(["angular", "curved"]).optional(),
  globalAssetHistory: z.array(globalAssetSchema).max(NODE_FLOW_IMPORT_LIMITS.globalAssets).optional(),
  nodeFlowContext: z.object({
    rawScript: z.string().max(5_000_000),
    episodes: z.array(z.unknown()).max(10_000),
    designAssets: z.array(z.unknown()).max(10_000),
    roles: z.array(z.unknown()).max(10_000),
  }).optional(),
  viewport: z.object({
    x: finiteCoordinate,
    y: finiteCoordinate,
    zoom: z.number().finite().positive().max(100),
  }).optional(),
  activeView: z.string().max(256).nullable().optional(),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const migrateNodeFlowEnvelope = (value: unknown) => {
  if (!isRecord(value)) throw new Error("项目文件根节点必须是对象。");
  const version = value.version === undefined ? 1 : Number(value.version);
  if (!Number.isInteger(version) || version < 1 || version > 2) {
    throw new Error(`不支持的项目文件版本：${String(value.version)}`);
  }

  return {
    version: 2 as const,
    revision: Number.isInteger(value.revision) && Number(value.revision) >= 0
      ? Number(value.revision)
      : 1,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : "Imported Stylo Project",
    nodes: Array.isArray(value.nodes) ? value.nodes : [],
    links: Array.isArray(value.links)
      ? value.links
      : Array.isArray(value.edges)
        ? value.edges
        : [],
    graphLinks: value.graphLinks,
    linkStyle: value.linkStyle,
    globalAssetHistory: value.globalAssetHistory,
    nodeFlowContext: value.nodeFlowContext,
    viewport: value.viewport ?? undefined,
    activeView: value.activeView ?? null,
  };
};

const formatSchemaError = (error: z.ZodError) =>
  error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ");

const assertBoundedJsonValue = (root: unknown, label: string) => {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let visitedValues = 0;
  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    visitedValues += 1;
    if (visitedValues > 250_000) throw new Error(`${label} 的嵌套数据过于复杂。`);
    if (depth > 32) throw new Error(`${label} 的嵌套层级超过限制。`);
    if (value === null || value === undefined || typeof value === "boolean") continue;
    if (typeof value === "string") {
      if (value.length > 10_000_000) throw new Error(`${label} 包含过长字符串。`);
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error(`${label} 包含非有限数值。`);
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length > 10_000) throw new Error(`${label} 包含过长数组。`);
      value.forEach((item) => stack.push({ value: item, depth: depth + 1 }));
      continue;
    }
    if (typeof value !== "object") throw new Error(`${label} 包含非 JSON 数据。`);
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 1_000) throw new Error(`${label} 的对象字段过多。`);
    entries.forEach(([key, item]) => {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new Error(`${label} 包含不安全字段。`);
      }
      stack.push({ value: item, depth: depth + 1 });
    });
  }
};

const assertNodeTypeData = (nodeFlow: NodeFlowFile) => {
  nodeFlow.nodes.forEach((node) => {
    assertBoundedJsonValue(node.data, `节点 ${node.id}`);
    if (node.style) assertBoundedJsonValue(node.style, `节点 ${node.id} 样式`);
    if (node.type === "pdfInput") {
      const data = node.data as Record<string, unknown>;
      if (data.pdf !== null && data.pdf !== undefined && typeof data.pdf !== "string") {
        throw new Error(`节点 ${node.id} 的 PDF 资源无效。`);
      }
      const highlights = data.highlights;
      if (!Array.isArray(highlights) || highlights.length > 2_000) {
        throw new Error(`节点 ${node.id} 的 PDF 高亮列表无效。`);
      }
      highlights.forEach((highlight, index) => {
        if (!isRecord(highlight)) {
          throw new Error(`节点 ${node.id} 的 PDF 高亮 ${index + 1} 无效。`);
        }
        const page = highlight.page;
        const bounds = [highlight.x, highlight.y, highlight.width, highlight.height];
        const color = highlight.color;
        if (
          typeof highlight.id !== "string" ||
          !highlight.id.trim() ||
          typeof page !== "number" ||
          !Number.isInteger(page) ||
          page < 1 ||
          bounds.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) ||
          Number(highlight.x) + Number(highlight.width) > 1.000_001 ||
          Number(highlight.y) + Number(highlight.height) > 1.000_001 ||
          (color !== "yellow" && color !== "green" && color !== "blue") ||
          typeof highlight.createdAt !== "number" ||
          !Number.isFinite(highlight.createdAt)
        ) {
          throw new Error(`节点 ${node.id} 的 PDF 高亮 ${index + 1} 无效。`);
        }
        if (
          highlight.quote !== undefined &&
          (typeof highlight.quote !== "string" || highlight.quote.length > 20_000)
        ) {
          throw new Error(`节点 ${node.id} 的 PDF 高亮 ${index + 1} 引用文本无效。`);
        }
        if (
          highlight.noteNodeId !== undefined &&
          (typeof highlight.noteNodeId !== "string" || !highlight.noteNodeId.trim())
        ) {
          throw new Error(`节点 ${node.id} 的 PDF 高亮 ${index + 1} 批注引用无效。`);
        }
        if (
          highlight.textStart !== undefined &&
          (typeof highlight.textStart !== "number" || !Number.isInteger(highlight.textStart) || highlight.textStart < 0)
        ) {
          throw new Error(`节点 ${node.id} 的 PDF 高亮 ${index + 1} 文本起点无效。`);
        }
        if (
          highlight.textEnd !== undefined &&
          (
            typeof highlight.textEnd !== "number" ||
            !Number.isInteger(highlight.textEnd) ||
            highlight.textEnd < Number(highlight.textStart || 0)
          )
        ) {
          throw new Error(`节点 ${node.id} 的 PDF 高亮 ${index + 1} 文本终点无效。`);
        }
        if (highlight.rects !== undefined) {
          if (!Array.isArray(highlight.rects) || highlight.rects.length > 200) {
            throw new Error(`节点 ${node.id} 的 PDF 高亮 ${index + 1} 文本选区无效。`);
          }
          highlight.rects.forEach((rect) => {
            if (!isRecord(rect)) {
              throw new Error(`节点 ${node.id} 的 PDF 高亮 ${index + 1} 文本选区无效。`);
            }
            const values = [rect.x, rect.y, rect.width, rect.height];
            if (
              values.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) ||
              Number(rect.x) + Number(rect.width) > 1.000_001 ||
              Number(rect.y) + Number(rect.height) > 1.000_001
            ) {
              throw new Error(`节点 ${node.id} 的 PDF 高亮 ${index + 1} 文本选区无效。`);
            }
          });
        }
      });
    }
    if (node.type !== "viduVideoGen") return;
    const subjects = (node.data as Record<string, unknown>).subjects;
    if (subjects !== undefined && !Array.isArray(subjects)) {
      throw new Error(`节点 ${node.id} 的 subjects 必须是数组。`);
    }
    (subjects || []).forEach((subject, index) => {
      if (!isRecord(subject)) throw new Error(`节点 ${node.id} 的 subject ${index + 1} 无效。`);
      for (const field of ["images", "videos"] as const) {
        const items = subject[field];
        if (items !== undefined && (
          !Array.isArray(items) ||
          items.length > 10 ||
          items.some((item) => typeof item !== "string")
        )) {
          throw new Error(`节点 ${node.id} 的 subject ${index + 1}.${field} 无效。`);
        }
      }
    });
  });
  if (nodeFlow.nodeFlowContext) {
    assertBoundedJsonValue(nodeFlow.nodeFlowContext, "项目上下文");
  }
};

const assertGraphIntegrity = (nodeFlow: NodeFlowFile) => {
  const nodeIds = new Set<string>();
  for (const node of nodeFlow.nodes) {
    if (nodeIds.has(node.id)) throw new Error(`项目包含重复节点 ID：${node.id}`);
    nodeIds.add(node.id);
  }

  const linkIds = new Set<string>();
  nodeFlow.links.forEach((link, index) => {
    if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) {
      throw new Error(`连线 ${link.id || index + 1} 指向不存在的节点。`);
    }
    if (link.id && linkIds.has(link.id)) throw new Error(`项目包含重复连线 ID：${link.id}`);
    if (link.id) linkIds.add(link.id);
  });

  const parentByNode = new Map<string, string>();
  for (const node of nodeFlow.nodes) {
    if (!node.parentId) continue;
    if (!nodeIds.has(node.parentId) || node.parentId === node.id) {
      throw new Error(`节点 ${node.id} 的父节点无效。`);
    }
    parentByNode.set(node.id, node.parentId);
  }
  for (const node of nodeFlow.nodes) {
    const visited = new Set<string>([node.id]);
    let parentId = parentByNode.get(node.id);
    while (parentId) {
      if (visited.has(parentId)) throw new Error(`节点 ${node.id} 的父级关系形成循环。`);
      visited.add(parentId);
      parentId = parentByNode.get(parentId);
    }
  }
};

export const parseNodeFlowFile = (value: unknown): NodeFlowFile => {
  const result = nodeFlowSchema.safeParse(migrateNodeFlowEnvelope(value));
  if (!result.success) {
    throw new Error(`项目文件结构无效：${formatSchemaError(result.error)}`);
  }

  // The schema validates the shared record envelope; node-type defaults perform
  // the final type-specific hydration after this boundary.
  const nodeFlow = result.data as unknown as NodeFlowFile;
  nodeFlow.links = nodeFlow.links.map((link, index) => ({
    ...link,
    id: link.id || `link-imported-${index + 1}`,
  }));
  assertNodeTypeData(nodeFlow);
  assertGraphIntegrity(nodeFlow);
  return nodeFlow;
};
