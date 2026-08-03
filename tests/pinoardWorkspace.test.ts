import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ProjectData } from "../types";
import {
  addPinoardNote,
  ensurePinoardForText,
  findPinoardForText,
  getPinoardMembers,
  removePinoardNote,
  updatePinoardNote,
} from "../utils/pinoardWorkspace";

const makeProject = (): ProjectData => ({
  fileName: "构思",
  rawScript: "",
  episodes: [],
  roles: [],
  designAssets: [],
  canvas: { viewport: null },
  flow: {
    revision: 1,
    flowNodes: [
      {
        id: "idea-1",
        type: "text",
        position: { x: 420, y: 160 },
        data: {
          title: "雨夜",
          text: "一辆车停在没有路灯的路边。",
          documentKind: "note",
          format: "markdown",
        },
      },
    ],
    links: [],
  },
  stats: { context: { total: 0, success: 0, error: 0 } },
});

test("double-click preparation creates one Pinoard and assigns the existing text fact", () => {
  const result = ensurePinoardForText(makeProject(), "idea-1", 100);
  assert.ok(result.pinoardId);
  assert.equal(result.projectData.flow?.flowNodes?.filter((node) => node.type === "pinoard").length, 1);
  assert.equal(findPinoardForText(result.projectData, "idea-1"), result.pinoardId);
  assert.equal(getPinoardMembers(result.projectData, result.pinoardId!).length, 1);

  const repeated = ensurePinoardForText(result.projectData, "idea-1", 200);
  assert.equal(repeated.projectData, result.projectData);
  assert.equal(repeated.pinoardId, result.pinoardId);
});

test("Pinoard notes remain ordinary text nodes and support add, edit, and delete", () => {
  const prepared = ensurePinoardForText(makeProject(), "idea-1", 100);
  const added = addPinoardNote(prepared.projectData, prepared.pinoardId!, 200);
  assert.ok(added.nodeId);
  assert.equal(
    added.projectData.flow?.flowNodes?.find((node) => node.id === added.nodeId)?.type,
    "text"
  );

  const updated = updatePinoardNote(
    added.projectData,
    prepared.pinoardId!,
    added.nodeId!,
    { title: "桥下", text: "人物第一次看见信号灯。" },
    300
  );
  assert.equal(
    updated.flow?.flowNodes?.find((node) => node.id === added.nodeId)?.data.text,
    "人物第一次看见信号灯。"
  );

  const removed = removePinoardNote(updated, prepared.pinoardId!, added.nodeId!, 400);
  assert.equal(removed.flow?.flowNodes?.some((node) => node.id === added.nodeId), false);
  assert.equal(
    removed.flow?.links.some((link) => link.source === added.nodeId || link.target === added.nodeId),
    false
  );
  assert.ok(removed.flow?.flowNodes?.some((node) => node.id === prepared.pinoardId));
});

test("Pinoard focus reuses Canvas Flow text nodes without a separate module surface", () => {
  const flowSource = readFileSync("node-workspace/components/FlowSurface.tsx", "utf8");
  const workspaceSource = readFileSync("node-workspace/components/CreativeWorkspace.tsx", "utf8");
  const nodeSource = readFileSync("node-workspace/nodes/PinoardNode.tsx", "utf8");
  const nodeStyles = readFileSync("node-workspace/styles/nodeflow.css", "utf8");

  assert.match(flowSource, /label: "Pinoard"[\s\S]*label: "Manus"/);
  assert.match(flowSource, /buildFocusedWrapperLayout/);
  assert.match(flowSource, /focusedWrapperMemberIds\.has\(node\.id\)/);
  assert.match(flowSource, /focusedLayout \? "wrapper-focus-node"/);
  assert.match(flowSource, /nodesDraggable: !isLocked && !focusedWrapperId/);
  assert.match(workspaceSource, /ensurePinoardForText\(projectData, textNodeId\)/);
  assert.match(workspaceSource, /focusedWrapperId: activePinoard\?\.pinoardId \|\| null/);
  assert.match(workspaceSource, /className="wrapper-focus-toolbar"/);
  assert.doesNotMatch(workspaceSource, /PinoardPanel/);
  assert.doesNotMatch(workspaceSource, /pinoard-toolbar__identity/);
  assert.match(nodeStyles, /\.react-flow__node\.wrapper-focus-node \.node-card-base/);
  assert.match(nodeStyles, /\.wrapper-focus-toolbar/);
  assert.match(nodeSource, /nodeType="pinoard-blueprint"/);
  assert.match(nodeSource, /pinoard-blueprint__upper/);
  assert.match(nodeSource, /pinoard-blueprint__route/);
  assert.match(nodeStyles, /\.pinoard-blueprint__upper[\s\S]*clip-path: polygon/);
  assert.match(nodeStyles, /\.pinoard-blueprint__paper-stack[\s\S]*#e8e3d8/);
  assert.match(nodeStyles, /\.pinoard-blueprint__pin[\s\S]*radial-gradient/);
  assert.match(nodeStyles, /\.pinoard-blueprint__fold-shadow/);
});
