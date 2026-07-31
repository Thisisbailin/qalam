import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ProjectData } from "../types";
import { createDefaultNodeFlowNodeData } from "../node-workspace/nodeflow/defaults";
import { buildWrapperProjection } from "../node-workspace/nodeflow/wrapperProjection";
import {
  addLeporelloPanel,
  createInitialLeporelloData,
  getLeporelloBook,
  getLeporelloPageImage,
  setLeporelloPageImage,
} from "../utils/leporelloWorkspace";

const makeProject = (): ProjectData => ({
  fileName: "雨夜公路.fountain",
  rawScript: "",
  episodes: [],
  roles: [],
  designAssets: [],
  canvas: { viewport: null },
  flow: {
    revision: 2,
    flowNodes: [{
      id: "leporello-1",
      type: "leporello",
      position: { x: 100, y: 120 },
      data: createInitialLeporelloData("雨夜公路"),
    }],
    links: [],
  },
  stats: { context: { total: 0, success: 0, error: 0 } },
});

test("Leporello starts as one 21:9 strip with project cover, one blank panel, and FIN back", () => {
  const defaults = createDefaultNodeFlowNodeData("leporello");
  const project = makeProject();
  const book = getLeporelloBook(project, "leporello-1");
  assert.equal(defaults.aspectRatio, "21:9");
  assert.equal(project.flow?.flowNodes?.[0].data.title, "雨夜公路");
  assert.deepEqual(book.pages.map((page) => page.kind), ["cover", "panel", "back"]);
  assert.deepEqual(book.pages.map((page) => page.face), ["lit", "shadow", "lit"]);
});

test("new Leporello panels are inserted before FIN and keep alternating illuminated faces", () => {
  const next = addLeporelloPanel(makeProject(), "leporello-1", 100);
  const book = getLeporelloBook(next, "leporello-1");
  assert.deepEqual(book.pages.map((page) => page.kind), ["cover", "panel", "panel", "back"]);
  assert.deepEqual(book.pages.map((page) => page.face), ["lit", "shadow", "lit", "shadow"]);
  assert.equal(next.flow?.revision, 3);
});

test("uploaded and sketched pages remain real image nodes referenced by the wrapper index", () => {
  const updated = setLeporelloPageImage(makeProject(), "leporello-1", "panel-1", {
    id: "leporello-frame-1",
    name: "frame.png",
    dataUrl: "data:image/png;base64,AA==",
    mimeType: "image/png",
    width: 2100,
    height: 900,
    hasAlpha: false,
    storageBucket: "assets",
    storagePath: "users/u/projects/p/leporello/frame.png",
  }, 200);
  const book = getLeporelloBook(updated, "leporello-1");
  const panel = book.pages.find((page) => page.kind === "panel")!;
  assert.equal(panel.imageNodeId, "leporello-frame-1");
  assert.equal(getLeporelloPageImage(updated, panel), "data:image/png;base64,AA==");
  assert.equal(updated.flow?.flowNodes?.find((node) => node.id === panel.imageNodeId)?.type, "imageInput");
  assert.equal(
    updated.flow?.flowNodes?.find((node) => node.id === panel.imageNodeId)?.data.storagePath,
    "users/u/projects/p/leporello/frame.png",
  );
  assert.equal(updated.flow?.links[0]?.data?.relation, "leporello-membership");

  const collapsedNodes = updated.flow!.flowNodes!.map((node) =>
    node.id === "leporello-1" ? { ...node, data: { ...node.data, wrapperCollapsed: true } } : node
  );
  const projection = buildWrapperProjection(collapsedNodes, updated.flow!.links);
  assert.deepEqual(projection.hiddenNodeIds, new Set(["leporello-frame-1"]));
});

test("Leporello UI is a continuous accordion and macOS sketch bridge is desktop-only", () => {
  const flowSource = readFileSync("node-workspace/components/FlowSurface.tsx", "utf8");
  const nodeSource = readFileSync("node-workspace/nodes/LeporelloNode.tsx", "utf8");
  const studioSource = readFileSync("node-workspace/components/leporello/LeporelloStudioPanel.tsx", "utf8");
  const styles = readFileSync("node-workspace/styles/leporello-studio.css", "utf8");
  const nodeStyles = readFileSync("node-workspace/styles/nodeflow.css", "utf8");
  const preload = readFileSync("electron/preload.cjs", "utf8");
  const main = readFileSync("electron/main.cjs", "utf8");

  assert.match(flowSource, /label: "Manus"[\s\S]*label: "Lookbook"[\s\S]*label: "Leporello"/);
  assert.match(flowSource, /type === "leporello"[\s\S]*some\(\(node\) => node\.type === "leporello"\)/);
  assert.match(studioSource, /isUnfolded/);
  assert.match(studioSource, /book\.pages\.slice\(0, 2\)/);
  assert.match(nodeSource, /book\.pages\.slice\(0, isCollapsed \? 2 : 3\)/);
  assert.match(nodeSource, /foldDepthLayers = isCollapsed \? 6 : 0/);
  assert.match(nodeSource, /leporello-node__underfold/);
  assert.doesNotMatch(nodeSource, /leporello-node__meta/);
  assert.doesNotMatch(studioSource, /previousPage|nextPage|上一页|下一页/);
  assert.match(studioSource, /网页端不提供手绘能力/);
  assert.match(styles, /aspect-ratio: 21 \/ 9/);
  assert.match(styles, /is-unfolded[\s\S]*rotateY/);
  assert.match(styles, /is-folded[\s\S]*nth-child\(2\)/);
  assert.match(nodeStyles, /\.leporello-node__panel[\s\S]*aspect-ratio: 21 \/ 9/);
  assert.match(nodeStyles, /width: 420px !important/);
  assert.match(nodeStyles, /height: 240px/);
  assert.match(nodeStyles, /\.leporello-node__underfold[\s\S]*--fold-depth/);
  assert.match(styles, /overflow-x: auto/);
  assert.match(preload, /startLeporelloSketch/);
  assert.match(main, /process\.platform !== "darwin"/);
  assert.match(main, /LEPORELLO_SKETCH_WIDTH = 2100/);
  assert.match(main, /LEPORELLO_SKETCH_HEIGHT = 900/);
  assert.match(main, /shell\.showItemInFolder/);
  assert.match(main, /leporelloSketchSessions\.get\(sessionId\)/);
});
