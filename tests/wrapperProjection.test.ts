import assert from "node:assert/strict";
import test from "node:test";
import { buildWrapperProjection } from "../node-workspace/nodeflow/wrapperProjection";
import type { NodeFlowLink, NodeFlowNode } from "../node-workspace/types";

const makeNode = (
  id: string,
  type: NodeFlowNode["type"],
  wrapperCollapsed = false
): NodeFlowNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { title: id, wrapperCollapsed } as NodeFlowNode["data"],
});

test("collapsed Lookbook hides only direct membership nodes and expands without deleting graph data", () => {
  const nodes = [
    makeNode("lookbook-1", "lookbook", true),
    makeNode("index-1", "text"),
    makeNode("image-1", "imageInput"),
    makeNode("ordinary-1", "text"),
  ];
  const links: NodeFlowLink[] = [
    { id: "index", source: "lookbook-1", target: "index-1", data: { relation: "lookbook-membership" } },
    { id: "image", source: "image-1", target: "lookbook-1", data: { relation: "lookbook-membership" } },
    { id: "ordinary", source: "lookbook-1", target: "ordinary-1" },
  ];

  const collapsed = buildWrapperProjection(nodes, links);
  assert.deepEqual(new Set(collapsed.memberIdsByWrapper.get("lookbook-1")), new Set(["index-1", "image-1"]));
  assert.deepEqual(collapsed.hiddenNodeIds, new Set(["index-1", "image-1"]));

  const expanded = buildWrapperProjection(
    nodes.map((node) => node.id === "lookbook-1" ? { ...node, data: { ...node.data, wrapperCollapsed: false } } : node),
    links
  );
  assert.deepEqual(expanded.hiddenNodeIds, new Set());
  assert.equal(expanded.memberIdsByWrapper.get("lookbook-1")?.length, 2);
});

test("a collapsed Manus folder wraps its script pages while screenplay page order stays independent", () => {
  const nodes = [
    {
      ...makeNode("manus", "folder", true),
      data: { title: "剧本", folderKind: "manus", wrapperCollapsed: true },
    } as NodeFlowNode,
    makeNode("page-a", "scriptPage"),
    makeNode("page-b", "scriptPage"),
    makeNode("page-c", "scriptPage"),
    makeNode("note", "text"),
  ];
  const links: NodeFlowLink[] = [
    { id: "ma", source: "manus", target: "page-a", data: { relation: "folder-membership" } },
    { id: "mb", source: "manus", target: "page-b", data: { relation: "folder-membership" } },
    { id: "mc", source: "manus", target: "page-c", data: { relation: "folder-membership" } },
    { id: "ab", source: "page-a", target: "page-b", data: { relation: "screenplay-page" } },
    { id: "bc", source: "page-b", target: "page-c", data: { relation: "screenplay-page" } },
    { id: "cb", source: "page-c", target: "page-b", data: { relation: "screenplay-page" } },
    { id: "note", source: "page-a", target: "note" },
  ];

  const projection = buildWrapperProjection(nodes, links);
  assert.deepEqual(projection.screenplayRootIds, new Set());
  assert.deepEqual(projection.memberIdsByWrapper.get("manus"), ["page-a", "page-b", "page-c"]);
  assert.equal(projection.memberIdsByWrapper.has("page-a"), false);
  assert.deepEqual(projection.hiddenNodeIds, new Set(["page-a", "page-b", "page-c"]));
});

test("collapsed Pinoard accepts only explicit text memberships in either direction", () => {
  const nodes = [
    makeNode("pinoard-1", "pinoard", true),
    makeNode("idea-a", "text"),
    makeNode("idea-b", "text"),
    makeNode("image-1", "imageInput"),
    makeNode("ordinary", "text"),
  ];
  const links: NodeFlowLink[] = [
    { id: "a", source: "pinoard-1", target: "idea-a", data: { relation: "pinoard-membership" } },
    { id: "b", source: "idea-b", target: "pinoard-1", data: { relation: "pinoard-membership" } },
    { id: "image", source: "pinoard-1", target: "image-1", data: { relation: "pinoard-membership" } },
    { id: "ordinary", source: "pinoard-1", target: "ordinary" },
  ];

  const projection = buildWrapperProjection(nodes, links);
  assert.deepEqual(
    new Set(projection.memberIdsByWrapper.get("pinoard-1")),
    new Set(["idea-a", "idea-b"])
  );
  assert.deepEqual(projection.hiddenNodeIds, new Set(["idea-a", "idea-b"]));
});
