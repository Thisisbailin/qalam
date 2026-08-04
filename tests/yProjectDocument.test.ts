import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import {
  applyProjectNodeGeometryPatches,
  applyProjectSnapshot,
  applyProjectSnapshotDelta,
  readProjectSnapshot,
} from "../collaboration/yProjectDocument";

const baseProject = (): any => ({
  fileName: "Project",
  rawScript: "OPEN",
  episodes: [],
  roles: [],
  designAssets: [],
  canvas: {},
  activeFlowProjectId: "project-main",
  flow: {
    revision: 0,
    flowNodes: [],
    links: [],
    graphLinks: [],
    globalAssetHistory: [],
  },
  flowProjects: [],
  stats: { context: { total: 0, success: 0, error: 0 } },
});

const createPeers = () => {
  const left = new Y.Doc();
  const right = new Y.Doc();
  applyProjectSnapshot(left, baseProject(), "seed");
  Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
  return { left, right, baseVector: Y.encodeStateVector(left) };
};

test("staging a semantically unchanged project emits no Yjs update", () => {
  const doc = new Y.Doc();
  const project = baseProject();
  applyProjectSnapshot(doc, project, "seed");
  let updates = 0;
  doc.on("update", () => {
    updates += 1;
  });

  applyProjectSnapshot(doc, structuredClone(project), "same-value-render");

  assert.equal(updates, 0);
  assert.equal(Y.encodeStateAsUpdate(doc, Y.encodeStateVector(doc)).byteLength, 2);
});

test("Yjs snapshots omit undefined object fields and preserve explicit null", () => {
  const doc = new Y.Doc();
  const project = baseProject();
  project.flow.links = [{
    id: "link-1",
    source: "source",
    target: "target",
    data: undefined,
    sourceHandle: null,
  }];

  applyProjectSnapshot(doc, project, "seed");
  const initialLink = readProjectSnapshot<any>(doc).flow.links[0];
  assert.equal(Object.hasOwn(initialLink, "data"), false);
  assert.equal(initialLink.sourceHandle, null);

  const contaminated = structuredClone(project);
  contaminated.flow.links[0].data = null;
  applyProjectSnapshot(doc, contaminated, "legacy-null");
  assert.equal(readProjectSnapshot<any>(doc).flow.links[0].data, null);

  contaminated.flow.links[0].data = undefined;
  applyProjectSnapshot(doc, contaminated, "normalized");
  assert.equal(Object.hasOwn(readProjectSnapshot<any>(doc).flow.links[0], "data"), false);
});

test("concurrent first nodes in an initially empty graph both survive", () => {
  const { left, right, baseVector } = createPeers();
  const leftProject = baseProject();
  const rightProject = baseProject();
  leftProject.flow.flowNodes = [{
    id: "node-left",
    type: "text",
    position: { x: 10, y: 20 },
    data: { title: "Left", markdown: "A" },
  }];
  rightProject.flow.flowNodes = [{
    id: "node-right",
    type: "text",
    position: { x: 30, y: 40 },
    data: { title: "Right", markdown: "B" },
  }];

  applyProjectSnapshot(left, leftProject, "left");
  applyProjectSnapshot(right, rightProject, "right");
  const leftUpdate = Y.encodeStateAsUpdate(left, baseVector);
  const rightUpdate = Y.encodeStateAsUpdate(right, baseVector);
  Y.applyUpdate(left, rightUpdate);
  Y.applyUpdate(right, leftUpdate);

  const leftSnapshot = readProjectSnapshot<typeof leftProject>(left);
  const rightSnapshot = readProjectSnapshot<typeof rightProject>(right);
  assert.deepEqual(leftSnapshot, rightSnapshot);
  assert.deepEqual(
    leftSnapshot.flow.flowNodes.map((node: { id: string }) => node.id).sort(),
    ["node-left", "node-right"],
  );
});

test("concurrent text edits converge without a whole-project conflict choice", () => {
  const { left, right, baseVector } = createPeers();
  const leftProject = baseProject();
  const rightProject = baseProject();
  leftProject.rawScript = "OPEN LEFT";
  rightProject.rawScript = "OPEN RIGHT";

  applyProjectSnapshot(left, leftProject, "left");
  applyProjectSnapshot(right, rightProject, "right");
  const leftUpdate = Y.encodeStateAsUpdate(left, baseVector);
  const rightUpdate = Y.encodeStateAsUpdate(right, baseVector);
  Y.applyUpdate(left, rightUpdate);
  Y.applyUpdate(right, leftUpdate);

  const leftText = readProjectSnapshot<ReturnType<typeof baseProject>>(left).rawScript;
  const rightText = readProjectSnapshot<ReturnType<typeof baseProject>>(right).rawScript;
  assert.equal(leftText, rightText);
  assert.match(leftText, /LEFT/);
  assert.match(leftText, /RIGHT/);
});

test("a stale client delta cannot delete a Manus page it never observed", () => {
  const cloud = new Y.Doc();
  const cloudProject = baseProject();
  cloudProject.flow.flowNodes = [
    { id: "page-a", type: "scriptPage", position: { x: 0, y: 0 }, data: { manuscriptId: "manus-1", content: "A" } },
    { id: "page-b", type: "scriptPage", position: { x: 360, y: 0 }, data: { manuscriptId: "manus-1", content: "B" } },
  ];
  applyProjectSnapshot(cloud, cloudProject, "cloud");

  const staleBefore = structuredClone(cloudProject);
  staleBefore.flow.flowNodes = [structuredClone(cloudProject.flow.flowNodes[1])];
  const staleAfter = structuredClone(staleBefore);
  staleAfter.flow.flowNodes[0].data.content = "B edited after login";
  applyProjectSnapshotDelta(cloud, staleBefore, staleAfter, "stale-device-edit");

  const result = readProjectSnapshot<typeof cloudProject>(cloud);
  assert.deepEqual(result.flow.flowNodes.map((node: { id: string }) => node.id), ["page-a", "page-b"]);
  assert.equal(result.flow.flowNodes[0].data.content, "A");
  assert.equal(result.flow.flowNodes[1].data.content, "B edited after login");
});

test("delta sync still honors an explicit local page deletion", () => {
  const doc = new Y.Doc();
  const before = baseProject();
  before.flow.flowNodes = [
    { id: "page-a", type: "scriptPage", position: { x: 0, y: 0 }, data: { content: "A" } },
    { id: "page-b", type: "scriptPage", position: { x: 360, y: 0 }, data: { content: "B" } },
  ];
  applyProjectSnapshot(doc, before, "seed");
  const after = structuredClone(before);
  after.flow.flowNodes = [after.flow.flowNodes[1]];

  applyProjectSnapshotDelta(doc, before, after, "delete-page-a");

  assert.deepEqual(
    readProjectSnapshot<typeof before>(doc).flow.flowNodes.map((node: { id: string }) => node.id),
    ["page-b"],
  );
});

test("node geometry patches update one Yjs node without replacing project content", () => {
  const doc = new Y.Doc();
  const project = baseProject();
  project.flowProjects = [{
    id: "project-main",
    title: "Main",
    color: "amber",
    durationMin: 120,
    rootNodeId: "root-main",
    createdAt: 1,
    updatedAt: 1,
    flow: {
      links: [],
      flowNodes: [
        { id: "node-a", type: "text", position: { x: 0, y: 0 }, data: { text: "keep" } } as any,
        { id: "node-b", type: "text", position: { x: 5, y: 5 }, data: { text: "sibling" } } as any,
      ],
    },
  }];
  project.activeFlowProjectId = "project-main";
  applyProjectSnapshot(doc, project as unknown as Record<string, unknown>, "seed");
  assert.equal(applyProjectNodeGeometryPatches(
    doc,
    "project-main",
    [{ nodeId: "node-a", position: { x: 42, y: 19 } }],
    2,
    "move",
  ), true);
  const result = readProjectSnapshot<any>(doc);
  assert.deepEqual(result.flowProjects[0].flow.flowNodes[0].position, { x: 42, y: 19 });
  assert.equal(result.flowProjects[0].flow.flowNodes[0].data.text, "keep");
  assert.equal(result.flowProjects[0].flow.flowNodes[1].data.text, "sibling");
  assert.equal(result.flowProjects[0].updatedAt, 2);
});
