import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ProjectData } from "../types";
import type { NodeFlowNode } from "../node-workspace/types";
import { pngHasTransparency } from "../utils/pngTransparency";
import {
  addLookbookPage,
  addLookbookImageAssets,
  addLookbookTextCard,
  buildAdaptiveLookbookLayouts,
  fitLookbookLayoutToPage,
  getLookbookPageIndexForLayout,
  projectLookbookBoardItems,
  moveLookbookNodeToPage,
  reflowLookbookLayouts,
  sanitizeLookbookLayout,
  getLookbookIndexNode,
  getLookbookPageCount,
  getLookbookSpreadCount,
  updateLookbookNodeLayout,
  updateLookbookTextCard,
} from "../utils/lookbookWorkspace";
import { addManualLookbookIdentity, getLookbookMemberNodes } from "../utils/lookbookIdentities";
import { createDefaultNodeFlowNodeData } from "../node-workspace/nodeflow/defaults";
import { resolveNodeFlowNodeTitle } from "../node-workspace/nodeflow/titles";

const makeProject = (): ProjectData => ({
  fileName: "Lookbook Workspace",
  rawScript: "",
  episodes: [],
  roles: [{
    id: "role-1",
    name: "林默",
    displayName: "林默",
    mention: "林默",
    kind: "person",
    tone: "emerald",
    summary: "人物身份",
    description: "",
    portraits: [],
    profileNodeId: "lookbook-index-role-1",
    profileDocumentId: "lookbook-index-role-1",
  }],
  designAssets: [],
  canvas: { viewport: null },
  flow: {
    revision: 4,
    flowNodes: [
      {
        id: "identity-1",
        type: "lookbook",
        position: { x: 100, y: 120 },
        data: { title: "林默", identityId: "role-1", lookbookIndexNodeId: "lookbook-index-role-1" },
      },
      {
        id: "lookbook-index-role-1",
        type: "text",
        position: { x: 490, y: 148 },
        data: {
          title: "林默 · Lookbook 索引",
          text: "# 林默\n\n## Lookbook 索引",
          content: "# 林默\n\n## Lookbook 索引",
          lookbookIdentityId: "role-1",
          lookbookRole: "index",
          lookbookBook: { version: 1, pageCount: 0, entries: [] },
        },
      },
    ],
    links: [{
      id: "link-identity-1-lookbook-index-role-1-lookbook",
      source: "identity-1",
      target: "lookbook-index-role-1",
      sourceHandle: "text",
      targetHandle: "text",
      data: { relation: "lookbook-membership" },
    }],
  },
  stats: { context: { total: 0, success: 0, error: 0 } },
});

const pngBytes = (colorType: number, includeTransparencyChunk = false) => {
  const chunks: number[] = [137, 80, 78, 71, 13, 10, 26, 10];
  const pushUint32 = (value: number) => chunks.push((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
  pushUint32(13);
  chunks.push(73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, colorType, 0, 0, 0, 0, 0, 0, 0);
  if (includeTransparencyChunk) {
    pushUint32(1);
    chunks.push(116, 82, 78, 83, 0, 0, 0, 0, 0);
  }
  pushUint32(0);
  chunks.push(73, 69, 78, 68, 0, 0, 0, 0);
  return new Uint8Array(chunks);
};

test("PNG transparency parser recognizes alpha color types and tRNS chunks", () => {
  assert.equal(pngHasTransparency(pngBytes(6)), true);
  assert.equal(pngHasTransparency(pngBytes(4)), true);
  assert.equal(pngHasTransparency(pngBytes(3, true)), true);
  assert.equal(pngHasTransparency(pngBytes(2)), false);
  assert.equal(pngHasTransparency(new Uint8Array([1, 2, 3])), false);
});

test("Lookbook adaptive layout gives landscape, square, and portrait media distinct geometry", () => {
  const nodes: NodeFlowNode[] = [
    { id: "wide", type: "imageInput", position: { x: 0, y: 0 }, data: { image: "x", filename: "wide.jpg", dimensions: { width: 1800, height: 900 } } },
    { id: "square", type: "imageInput", position: { x: 0, y: 0 }, data: { image: "x", filename: "square.jpg", dimensions: { width: 1200, height: 1200 } } },
    { id: "portrait", type: "imageInput", position: { x: 0, y: 0 }, data: { image: "x", filename: "portrait.png", dimensions: { width: 800, height: 1400 }, hasAlpha: true } },
  ];
  const layouts = buildAdaptiveLookbookLayouts(nodes);
  assert.ok(layouts.get("wide")!.width > layouts.get("square")!.width);
  assert.ok(layouts.get("portrait")!.width < layouts.get("square")!.width);
  assert.ok(layouts.get("portrait")!.height > layouts.get("wide")!.height);
  assert.equal(layouts.get("portrait")!.fit, "contain");
});

test("Lookbook image import creates connected Flow nodes in one revision", () => {
  const result = addLookbookImageAssets(makeProject(), "identity-1", [
    {
      id: "image-alpha",
      name: "silhouette.png",
      dataUrl: "https://signed.example/image-alpha",
      mimeType: "image/png",
      width: 640,
      height: 960,
      hasAlpha: true,
      storageBucket: "assets",
      storagePath: "users/u/projects/p/lookbook/image-alpha.png",
    },
    { id: "image-wide", name: "warehouse.jpg", dataUrl: "data:image/jpeg;base64,AA==", mimeType: "image/jpeg", width: 1600, height: 900, hasAlpha: false },
  ], 100);
  assert.equal(result.flow?.revision, 5);
  assert.equal(result.flow?.flowNodes?.filter((node) => node.type === "imageInput").length, 2);
  assert.equal(result.flow?.links.filter((link) => link.data?.relation === "lookbook-membership").length, 3);
  const alpha = result.flow?.flowNodes?.find((node) => node.id === "image-alpha");
  const alphaLink = result.flow?.links.find((link) => link.source === "image-alpha");
  assert.equal(alpha?.data.hasAlpha, true);
  assert.equal(alpha?.data.storageBucket, "assets");
  assert.equal(alpha?.data.storagePath, "users/u/projects/p/lookbook/image-alpha.png");
  assert.equal(alpha?.data.lookbookLayout, undefined);
  const index = getLookbookIndexNode(result, "identity-1");
  const alphaEntry = (index?.data.lookbookBook as { entries?: Array<{ nodeId: string; layout: { fit: string } }> }).entries?.find((entry) => entry.nodeId === "image-alpha");
  assert.equal(alphaEntry?.layout.fit, "contain");
  assert.deepEqual(
    { target: alphaLink?.target, sourceHandle: alphaLink?.sourceHandle, targetHandle: alphaLink?.targetHandle },
    { target: "identity-1", sourceHandle: "image", targetHandle: "image" }
  );
  assert.ok((alpha?.position.y || 0) > 400);
});

test("Lookbook text cards create real connected text nodes and persist editing", () => {
  const created = addLookbookTextCard(makeProject(), "identity-1", 200);
  assert.ok(created.nodeId);
  assert.equal(created.projectData.flow?.revision, 5);
  assert.equal(created.projectData.flow?.links.some((link) => link.source === "identity-1" && link.target === created.nodeId), true);
  const edited = updateLookbookTextCard(created.projectData, created.nodeId!, { title: "服装逻辑", text: "雨水会加深布料颜色。" });
  const node = edited.flow?.flowNodes?.find((item) => item.id === created.nodeId);
  assert.equal(node?.data.title, "服装逻辑");
  assert.equal(node?.data.text, "雨水会加深布料颜色。");
});

test("new text nodes are Markdown documents rather than a separate archive type", () => {
  const defaults = createDefaultNodeFlowNodeData("text");
  assert.equal(defaults.title, "文本");
  assert.equal(defaults.format, "markdown");
  assert.equal(defaults.documentKind, "note");
  assert.equal(resolveNodeFlowNodeTitle({
    id: "legacy-text",
    type: "text",
    position: { x: 0, y: 0 },
    data: { title: "Markdown 文本" },
  }), "文本");
  assert.equal(resolveNodeFlowNodeTitle({
    id: "custom-text",
    type: "text",
    position: { x: 0, y: 0 },
    data: { title: "服装记录" },
  }), "服装记录");
});

test("Lookbook can persist empty pages independently from connected content", () => {
  const first = addLookbookPage(makeProject(), "identity-1");
  const third = addLookbookPage(first, "identity-1", 2);
  const items = projectLookbookBoardItems(third, "identity-1");
  assert.equal(items.length, 0);
  assert.equal(getLookbookPageCount(first, "identity-1"), 1);
  assert.equal(getLookbookPageCount(third, "identity-1"), 3);
  assert.equal(getLookbookSpreadCount(items, getLookbookPageCount(third, "identity-1")), 2);
  assert.equal(
    (getLookbookIndexNode(third, "identity-1")?.data.lookbookBook as { pageCount?: number }).pageCount,
    3
  );
});

test("manual identity creation atomically creates its role, index, and Lookbook link", () => {
  const result = addManualLookbookIdentity(makeProject(), {
    position: { x: 320, y: 180 },
    now: 10,
  });
  const identityNode = result.projectData.flow?.flowNodes?.find((node) => node.id === result.identityNodeId);
  const role = result.projectData.roles?.find((item) => item.id === identityNode?.data.identityId);
  const indexNode = result.projectData.flow?.flowNodes?.find((node) => node.id === role?.profileNodeId);

  assert.equal(result.projectData.flow?.revision, 5);
  assert.equal(identityNode?.type, "lookbook");
  assert.equal(indexNode?.type, "text");
  assert.deepEqual(identityNode?.position, { x: 320, y: 180 });
  assert.equal(identityNode?.data.lookbookIndexNodeId, indexNode?.id);
  assert.equal(getLookbookMemberNodes(result.projectData, result.identityNodeId).some((node) => node.id === indexNode?.id), true);
});

test("Lookbook manual layout persists independently from the Flow canvas position", () => {
  const withImage = addLookbookImageAssets(makeProject(), "identity-1", [
    { id: "image-1", name: "portrait.png", dataUrl: "data:image/png;base64,AA==", mimeType: "image/png", width: 800, height: 1200, hasAlpha: true },
  ], 300);
  const originalPosition = withImage.flow?.flowNodes?.find((node) => node.id === "image-1")?.position;
  const updated = updateLookbookNodeLayout(withImage, "image-1", {
    x: 0.52, y: 0.18, width: 0.31, height: 0.46, rotation: 1.2, zIndex: 9, fit: "contain",
  });
  const updatedNode = updated.flow?.flowNodes?.find((node) => node.id === "image-1");
  assert.deepEqual(updatedNode?.position, originalPosition);
  assert.equal(updatedNode?.data.lookbookLayout, undefined);
  const indexEntry = (getLookbookIndexNode(updated, "identity-1")?.data.lookbookBook as { entries?: Array<{ nodeId: string; layout: { x: number } }> }).entries?.find((entry) => entry.nodeId === "image-1");
  assert.equal(indexEntry?.layout.x, 0.528);
  assert.equal(projectLookbookBoardItems(updated, "identity-1")[0].layout.zIndex, 9);

  const withNewText = addLookbookTextCard(updated, "identity-1", 301).projectData;
  const preservedImage = projectLookbookBoardItems(withNewText, "identity-1").find((item) => item.node.id === "image-1");
  assert.equal(preservedImage?.layout.x, 0.528);
  assert.equal(preservedImage?.layout.zIndex, 9);
});

test("Lookbook layout sanitization keeps resized items inside the board and skips no-op revisions", () => {
  const bounded = sanitizeLookbookLayout({
    x: 0.8, y: 0.2, width: 0.6, height: 0.3, rotation: 0, zIndex: 1, fit: "cover",
  });
  assert.equal(bounded.x + bounded.width, 1);

  const created = addLookbookTextCard(makeProject(), "identity-1", 500).projectData;
  const textNode = created.flow?.flowNodes?.find((node) => node.type === "text");
  const unchanged = updateLookbookTextCard(created, textNode!.id, {
    title: textNode!.data.title as string,
    text: textNode!.data.text as string,
  });
  assert.equal(unchanged, created);
});

test("Lookbook page fitting keeps content inside one physical page", () => {
  const fitted = fitLookbookLayoutToPage({
    x: 0.31, y: -0.2, width: 0.68, height: 0.92, rotation: 2, zIndex: 3, fit: "cover",
  }, 1);
  assert.ok(fitted.x >= 0.528);
  assert.ok(fitted.x + fitted.width <= 0.972);
  assert.ok(fitted.y >= 0.05);
  assert.ok(fitted.y + fitted.height <= 0.63);
  assert.equal(getLookbookPageIndexForLayout(0, fitted), 1);
});

test("Lookbook content can move to an exact page and preserves page-safe geometry", () => {
  const withPages = addLookbookPage(addLookbookPage(makeProject(), "identity-1", 2), "identity-1", 2);
  const withImage = addLookbookImageAssets(withPages, "identity-1", [
    { id: "move-image", name: "move.jpg", dataUrl: "data:image/jpeg;base64,AA==", mimeType: "image/jpeg", width: 900, height: 1200, hasAlpha: false },
  ], 900);
  const moved = moveLookbookNodeToPage(withImage, "identity-1", "move-image", 3);
  const item = projectLookbookBoardItems(moved, "identity-1").find((candidate) => candidate.node.id === "move-image");
  assert.equal(item?.spreadIndex, 1);
  assert.equal(item ? getLookbookPageIndexForLayout(item.spreadIndex, item.layout) : -1, 3);
  assert.ok((item?.layout.x || 0) >= 0.528);
  assert.ok((item?.layout.x || 0) + (item?.layout.width || 0) <= 0.972);
});

test("Lookbook reflow is deterministic and writes only the attached index document", () => {
  const created = addLookbookTextCard(addLookbookImageAssets(makeProject(), "identity-1", [
    { id: "image-1", name: "frame.jpg", dataUrl: "data:image/jpeg;base64,AA==", mimeType: "image/jpeg", width: 1500, height: 900, hasAlpha: false },
  ], 400), "identity-1", 401).projectData;
  const first = reflowLookbookLayouts(created, "identity-1");
  const second = reflowLookbookLayouts(first, "identity-1");
  assert.deepEqual(
    projectLookbookBoardItems(first, "identity-1").map((item) => item.layout),
    projectLookbookBoardItems(second, "identity-1").map((item) => item.layout)
  );
  assert.equal(first.flow?.flowNodes?.find((node) => node.id === "identity-1")?.data.lookbookLayout, undefined);
  assert.equal(first.flow?.flowNodes?.find((node) => node.id === "image-1")?.data.lookbookLayout, undefined);
  assert.ok(getLookbookIndexNode(first, "identity-1")?.data.lookbookBook);
});

test("Lookbook active UI uses the editable studio with bounded high-frequency interactions", () => {
  const workspaceSource = readFileSync("node-workspace/components/CreativeWorkspace.tsx", "utf8");
  const flowSurfaceSource = readFileSync("node-workspace/components/FlowSurface.tsx", "utf8");
  const wrapperEdgeSource = readFileSync("node-workspace/edges/WrapperMembershipEdge.tsx", "utf8");
  const studioSource = readFileSync("node-workspace/components/lookbook/LookbookStudioPanel.tsx", "utf8");
  const itemSource = readFileSync("node-workspace/components/lookbook/LookbookBoardItem.tsx", "utf8");
  const coverSource = readFileSync("node-workspace/nodes/CompactIdentityCardNode.tsx", "utf8");
  const textNodeSource = readFileSync("node-workspace/nodes/TextNode.tsx", "utf8");
  const styleSource = readFileSync("node-workspace/styles/lookbook-studio.css", "utf8");
  const nodeflowStyleSource = readFileSync("node-workspace/styles/nodeflow.css", "utf8");

  assert.match(workspaceSource, /<LookbookStudioPanel[\s\S]*setProjectData=\{setProjectData\}/);
  assert.match(flowSurfaceSource, /type: "lookbook"[\s\S]*disabled: true/);
  assert.match(flowSurfaceSource, /isLookbookNodeType\(type\)[\s\S]*\? null/);
  assert.match(flowSurfaceSource, /wrapperClickTimerRef[\s\S]*toggleWrapperCollapsed/);
  assert.match(wrapperEdgeSource, /getBezierPath\([\s\S]*sourcePosition[\s\S]*targetPosition[\s\S]*curvature: 0\.28/);
  assert.match(flowSurfaceSource, /LOOKBOOK_MEMBERSHIP_RELATION[\s\S]*FOLDER_MEMBERSHIP_RELATION[\s\S]*wrapperMembership/);
  assert.match(flowSurfaceSource, /wrapperToggleLockRef[\s\S]*now \+ 600/);
  assert.match(flowSurfaceSource, /wrapper-member--\$\{wrapperMemberMotion\?\.mode\}/);
  assert.match(flowSurfaceSource, /handleScriptNodeDoubleClick[\s\S]*onOpenScriptDocument/);
  assert.match(flowSurfaceSource, /label: "文本"[\s\S]*type: "text"[\s\S]*group: "input"/);
  assert.match(studioSource, /inspectLookbookImageFiles/);
  assert.match(studioSource, /saveActiveFlowIntoProjects/);
  assert.match(studioSource, /onDrop=/);
  assert.match(studioSource, /onContextMenu=/);
  assert.match(studioSource, /isEditingText/);
  assert.match(studioSource, /eventTarget\.closest\("input, textarea/);
  assert.match(studioSource, /lookbook-book-cover/);
  assert.match(studioSource, /lookbook-page-strip/);
  assert.match(studioSource, /moveLookbookNodeToPage/);
  assert.doesNotMatch(studioSource, /initial=\{\{[^}]*scale:/);
  assert.match(studioSource, /type BookView[\s\S]*kind: "front"[\s\S]*kind: "spread"[\s\S]*kind: "back"/);
  assert.match(studioSource, /合上为 Lookbook 封面/);
  assert.match(studioSource, /合上为 Lookbook 封底/);
  assert.doesNotMatch(studioSource, /lookbook-book-spread__turning-page/);
  assert.match(studioSource, /addLookbookPage/);
  assert.match(studioSource, /lookbook-studio__close/);
  assert.doesNotMatch(studioSource, /lookbook-studio__header/);
  assert.doesNotMatch(studioSource, /lookbook-inspector/);
  assert.match(itemSource, /dragMomentum=\{false\}/);
  assert.match(itemSource, /requestAnimationFrame\(applyPreview\)/);
  assert.match(itemSource, /window\.removeEventListener\("pointermove"/);
  assert.doesNotMatch(itemSource, /initial=\{\{\s*opacity:\s*0,\s*y:/);
  assert.match(coverSource, /if \(typeof image === "string" && image\) return image/);
  assert.match(coverSource, /inputs=\{\["image", "audio", "video", "text"\]\}/);
  assert.doesNotMatch(coverSource, /inputs=\{\["multi"/);
  assert.doesNotMatch(coverSource, /slice\(0,\s*2\)|coverImages/);
  assert.match(textNodeSource, /script-manuscript-node/);
  assert.match(styleSource, /\.lookbook-spread-item\.is-sticker[\s\S]*background:\s*transparent/);
  assert.doesNotMatch(styleSource, /lookbook-inspector/);
  assert.match(styleSource, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(styleSource, /filter:\s*drop-shadow|text-shadow|#000000/);
  assert.match(nodeflowStyleSource, /data-node-type="lookbook-cover"[\s\S]*width:\s*320px\s*!important/);
  assert.match(nodeflowStyleSource, /\.lookbook-node-cover \{[\s\S]*height:\s*320px/);
  assert.match(nodeflowStyleSource, /data-node-type="script-document"[\s\S]*width:\s*286px\s*!important/);
  assert.match(nodeflowStyleSource, /data-node-type="lookbook-cover"\]\[data-variant="media"\][\s\S]*content:\s*none/);
  const pageBlockRule = nodeflowStyleSource.match(/\.lookbook-node-cover__page-block \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.doesNotMatch(pageBlockRule, /repeating-linear-gradient/);
  assert.doesNotMatch(pageBlockRule, /linear-gradient/);
  const frontBoardRule = nodeflowStyleSource.match(/\.lookbook-node-cover__front-board \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.doesNotMatch(frontBoardRule, /linear-gradient|white|glow/);
  const studioCoverRule = styleSource.match(/\.lookbook-book-cover \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.doesNotMatch(studioCoverRule, /linear-gradient|radial-gradient/);
  const studioMediaRule = styleSource.match(/\.lookbook-spread-item__media \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.doesNotMatch(studioMediaRule, /box-shadow|filter/);
  assert.match(nodeflowStyleSource, /@keyframes wrapper-member-collapse[\s\S]*@keyframes wrapper-member-expand/);
});
