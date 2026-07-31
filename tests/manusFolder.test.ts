import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  FOLDER_MEMBERSHIP_RELATION,
  getManusFolderForPage,
  isManusFolderNode,
  normalizeManusFolderStructure,
} from "../node-workspace/manus/folder";
import type { NodeFlowLink, NodeFlowNode } from "../node-workspace/types";

const makePage = (
  id: string,
  position: { x: number; y: number },
  manuscriptId?: string
): NodeFlowNode => ({
  id,
  type: "scriptPage",
  position,
  data: {
    title: "雾中来客",
    text: id,
    documentKind: "script",
    format: "fountain",
    manuscriptId,
  },
});

test("legacy screenplay chains migrate into one system Manus folder without changing page order links", () => {
  const nodes = [
    makePage("page-a", { x: 760, y: 100 }, "screenplay-main"),
    makePage("page-b", { x: 400, y: 100 }, "screenplay-main"),
  ];
  const links: NodeFlowLink[] = [{
    id: "page-order",
    source: "page-a",
    target: "page-b",
    sourceHandle: "text",
    targetHandle: "text",
    data: { relation: "screenplay-page" },
  }];

  const normalized = normalizeManusFolderStructure(nodes, links);
  const folder = normalized.nodes.find(isManusFolderNode);

  assert.ok(folder);
  assert.equal(folder.data.systemManaged, true);
  assert.equal(folder.data.manuscriptId, "screenplay-main");
  assert.equal(normalized.links.some((link) => link.id === "page-order"), true);
  assert.equal(
    normalized.links.filter((link) => link.data?.relation === FOLDER_MEMBERSHIP_RELATION).length,
    2
  );
  assert.equal(getManusFolderForPage(normalized.nodes, normalized.links, "page-a")?.id, folder.id);
  assert.equal(getManusFolderForPage(normalized.nodes, normalized.links, "page-b")?.id, folder.id);
  assert.equal(normalized.nodes.find((node) => node.id === "page-a")?.data.pageNumber, 1);
  assert.equal(normalized.nodes.find((node) => node.id === "page-b")?.data.pageNumber, 2);
});

test("a missing membership is repaired onto the existing Manus folder with the same manuscript id", () => {
  const folder: NodeFlowNode = {
    id: "manus-folder-existing",
    type: "folder",
    position: { x: 0, y: 0 },
    data: {
      title: "剧本",
      folderKind: "manus",
      systemManaged: true,
      manuscriptId: "screenplay-main",
    },
  };
  const page = makePage("page-a", { x: 320, y: 0 }, "screenplay-main");

  const normalized = normalizeManusFolderStructure([folder, page], []);

  assert.equal(normalized.nodes.filter(isManusFolderNode).length, 1);
  assert.equal(getManusFolderForPage(normalized.nodes, normalized.links, page.id)?.id, folder.id);
});

test("Manus containment accepts only script pages and normalization is idempotent", () => {
  const page = makePage("page-a", { x: 400, y: 100 });
  const folder: NodeFlowNode = {
    id: "manus-folder-a",
    type: "folder",
    position: { x: 80, y: 100 },
    data: {
      title: "剧本",
      folderKind: "manus",
      systemManaged: true,
      manuscriptId: "manuscript-a",
    },
  };
  const note: NodeFlowNode = {
    id: "note-a",
    type: "text",
    position: { x: 400, y: 500 },
    data: { title: "备注", text: "不属于 Manus" },
  };
  const links: NodeFlowLink[] = [
    {
      id: "valid",
      source: folder.id,
      target: page.id,
      sourceHandle: "contains",
      targetHandle: "contains",
      data: { relation: FOLDER_MEMBERSHIP_RELATION },
    },
    {
      id: "invalid",
      source: folder.id,
      target: note.id,
      sourceHandle: "contains",
      targetHandle: "contains",
      data: { relation: FOLDER_MEMBERSHIP_RELATION },
    },
  ];

  const first = normalizeManusFolderStructure([folder, page, note], links);
  assert.equal(first.links.some((link) => link.id === "invalid"), false);
  assert.equal(
    first.links.filter((link) => link.data?.relation === FOLDER_MEMBERSHIP_RELATION).length,
    1
  );

  const second = normalizeManusFolderStructure(first.nodes, first.links);
  assert.deepEqual(second.nodes, first.nodes);
  assert.deepEqual(second.links, first.links);
  assert.equal(second.changed, false);
});

test("Manus folders render as an interactive paper stack instead of a generic folder card", async () => {
  const [componentSource, stylesheetSource] = await Promise.all([
    readFile(path.join(process.cwd(), "node-workspace/nodes/FolderNode.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "node-workspace/styles/nodeflow.css"), "utf8"),
  ]);

  assert.match(componentSource, /manus-wrapper-node__sheet--front/);
  assert.match(componentSource, /<Paperclip/);
  assert.match(componentSource, /data-state=\{isCollapsed \? "collapsed" : "expanded"\}/);
  assert.match(stylesheetSource, /\.manus-wrapper-node__sheet--back/);
  assert.match(stylesheetSource, /data-state="collapsed"/);
  assert.match(stylesheetSource, /prefers-reduced-motion/);
});
