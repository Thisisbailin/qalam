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

test("Pinoard opens as an independent editor workspace while Flow keeps memberships", () => {
  const flowSource = readFileSync("node-workspace/components/FlowSurface.tsx", "utf8");
  const workspaceSource = readFileSync("node-workspace/components/CreativeWorkspace.tsx", "utf8");
  const panelSource = readFileSync("node-workspace/components/PinoardPanel.tsx", "utf8");
  const nodeSource = readFileSync("node-workspace/nodes/PinoardNode.tsx", "utf8");
  const nodeStyles = readFileSync("node-workspace/styles/nodeflow.css", "utf8");

  assert.match(flowSource, /label: "Pinoard"[\s\S]*label: "Manus"/);
  assert.match(flowSource, /isCollapsiblePinoard/);
  assert.match(flowSource, /flowContentTruncated/);
  assert.match(workspaceSource, /ensurePinoardForText\(projectData, textNodeId\)/);
  assert.match(workspaceSource, /<PinoardPanel/);
  assert.doesNotMatch(workspaceSource, /focusedWrapperId: activePinoard/);
  assert.match(panelSource, /className="pinoard-workspace"/);
  assert.match(panelSource, /getPinoardMembers/);
  assert.match(panelSource, /updatePinoardNote/);
  assert.match(nodeSource, /nodeType="pinoard-wrapper"/);
  assert.match(nodeSource, /pinoard-wrapper-node__sheet--front/);
  assert.match(nodeStyles, /\.pinoard-wrapper-node__sheet--front/);
  assert.match(nodeStyles, /\.pinoard-wrapper-node__pin/);
});
