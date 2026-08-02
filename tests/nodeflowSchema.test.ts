import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NODE_FLOW_IMPORT_LIMITS,
  parseNodeFlowFile,
} from "../node-workspace/nodeflow/schema";

const makeNode = (id: string, parentId?: string) => ({
  id,
  type: "text" as const,
  position: { x: 0, y: 0 },
  data: { text: id },
  ...(parentId ? { parentId } : {}),
});

const makeProject = () => ({
  version: 2,
  revision: 3,
  name: "Schema Test",
  nodes: [makeNode("source"), makeNode("target")],
  links: [{ source: "source", target: "target" }],
});

test("schema migrates legacy edges and assigns stable imported link IDs", () => {
  const legacy = {
    name: "Legacy Project",
    nodes: [makeNode("source"), makeNode("target")],
    edges: [{ source: "source", target: "target" }],
  };

  const parsed = parseNodeFlowFile(legacy);

  assert.equal(parsed.version, 2);
  assert.equal(parsed.revision, 1);
  assert.equal(parsed.links[0]?.id, "link-imported-1");
  assert.equal(parsed.activeView, null);
  assert.equal("id" in legacy.edges[0], false, "parsing must not mutate caller data");
});

test("schema repairs null link data from realtime snapshots without accepting invalid shapes", () => {
  const parsed = parseNodeFlowFile({
    ...makeProject(),
    links: [{ source: "source", target: "target", data: null }],
  });

  assert.equal(parsed.links[0]?.data, undefined);
  assert.equal(Object.hasOwn(parsed.links[0]!, "data"), false);
  assert.throws(
    () => parseNodeFlowFile({
      ...makeProject(),
      links: [{ source: "source", target: "target", data: [] }],
    }),
    /项目文件结构无效/,
  );
});

test("schema rejects unsupported versions and invalid coordinates", () => {
  assert.throws(
    () => parseNodeFlowFile({ ...makeProject(), version: 99 }),
    /不支持的项目文件版本/
  );
  assert.throws(
    () => parseNodeFlowFile({
      ...makeProject(),
      nodes: [{ ...makeNode("source"), position: { x: Number.POSITIVE_INFINITY, y: 0 } }],
      links: [],
    }),
    /项目文件结构无效/
  );
});

test("schema enforces graph identity, references, and acyclic parents", () => {
  assert.throws(
    () => parseNodeFlowFile({
      ...makeProject(),
      nodes: [makeNode("duplicate"), makeNode("duplicate")],
      links: [],
    }),
    /重复节点 ID/
  );
  assert.throws(
    () => parseNodeFlowFile({
      ...makeProject(),
      links: [{ source: "source", target: "missing" }],
    }),
    /指向不存在的节点/
  );
  assert.throws(
    () => parseNodeFlowFile({
      ...makeProject(),
      nodes: [makeNode("a", "b"), makeNode("b", "a")],
      links: [],
    }),
    /父级关系形成循环/
  );
});

test("schema rejects projects beyond the node count limit", () => {
  const nodes = Array.from(
    { length: NODE_FLOW_IMPORT_LIMITS.nodes + 1 },
    (_, index) => makeNode(`node-${index}`)
  );

  assert.throws(
    () => parseNodeFlowFile({ ...makeProject(), nodes, links: [] }),
    /项目文件结构无效/
  );
});

test("schema rejects unsafe node data shapes before components render", () => {
  assert.throws(
    () => parseNodeFlowFile({
      ...makeProject(),
      nodes: [{
        id: "vidu-1",
        type: "viduVideoGen",
        position: { x: 0, y: 0 },
        data: { subjects: { not: "an array" } },
      }],
      links: [],
    }),
    /subjects 必须是数组/
  );
  const sanitized = parseNodeFlowFile({
    ...makeProject(),
    nodes: [{
      ...makeNode("unsafe"),
      data: JSON.parse('{"__proto__":{"polluted":true}}'),
    }],
    links: [],
  });
  assert.equal(Object.prototype.hasOwnProperty.call(sanitized.nodes[0].data, "__proto__"), false);
});
