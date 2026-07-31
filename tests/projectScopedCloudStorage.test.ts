import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { mergeStyloScopedProjectData, resetStyloScopedProjectData } from "../agents/runtime/projectScope";
import { normalizeProjectId } from "../functions/api/_projectScope";
import type { ProjectData } from "../types";
import { hydrateCloudProjectCatalog } from "../sync/projectCatalog";
import {
  isNodeGeometryOnlyProjectChange,
  patchProjectSyncSnapshotGeometry,
} from "../sync/projectSyncAdapter";
import { mergeProjectSnapshotsAcrossEpoch } from "../sync/projectThreeWayMerge";

const read = (path: string) => readFileSync(path, "utf8");

const projectData = (activeId: string, ids: string[]): ProjectData => ({
  fileName: activeId,
  rawScript: "",
  episodes: [],
  roles: [],
  designAssets: [],
  canvas: { viewport: { x: 0, y: 0, zoom: 1 } },
  stats: { context: { total: 0, success: 0, error: 0 } },
  activeFlowProjectId: activeId,
  flow: { revision: 0, flowNodes: [], graphLinks: [], globalAssetHistory: [], links: [] },
  flowProjects: ids.map((id, index) => ({
    id,
    title: id,
    color: "#888888",
    rootNodeId: `root-${id}`,
    durationMin: 120,
    createdAt: index + 1,
    updatedAt: index + 1,
    flow: { revision: index, flowNodes: [], graphLinks: [], globalAssetHistory: [], links: [] },
  })),
});

test("project ids are fail-closed and safe for SQL and object-store boundaries", () => {
  assert.equal(normalizeProjectId("project-a"), "project-a");
  assert.equal(normalizeProjectId(" scene:01.v2 "), "scene:01.v2");
  assert.equal(normalizeProjectId(""), "");
  assert.equal(normalizeProjectId("../project-a"), "");
  assert.equal(normalizeProjectId("项目-a"), "");
});

test("applying one remote project cannot replace a sibling local project", () => {
  const local = projectData("project-a", ["project-a", "project-b"]);
  const remoteB = projectData("project-b", ["project-b"]);
  remoteB.flowProjects![0].title = "remote-b";
  remoteB.flowProjects![0].flow.revision = 9;

  const merged = mergeStyloScopedProjectData(local, remoteB, "project-b");
  assert.equal(merged.activeFlowProjectId, "project-a");
  assert.equal(merged.fileName, "project-a");
  assert.equal(merged.flowProjects?.find((item) => item.id === "project-a")?.title, "project-a");
  assert.equal(merged.flowProjects?.find((item) => item.id === "project-b")?.title, "remote-b");
  assert.equal(merged.flowProjects?.find((item) => item.id === "project-b")?.flow.revision, 9);
});

test("non-canvas project content survives project switches independently", async () => {
  const { switchAccountProject } = await import("../utils/accountProjects");
  const local = projectData("project-a", ["project-a", "project-b"]);
  local.rawScript = "A SCRIPT";
  local.episodes = [{ id: 1, title: "A", content: "A", scenes: [], status: "completed" }];
  local.flowProjects![0].rawScript = "A SCRIPT";
  local.flowProjects![0].episodes = local.episodes;
  local.flowProjects![1].rawScript = "B SCRIPT";
  local.flowProjects![1].episodes = [{ id: 2, title: "B", content: "B", scenes: [], status: "completed" }];

  const switched = switchAccountProject(local, "project-b");
  assert.equal(switched.rawScript, "B SCRIPT");
  assert.equal(switched.episodes[0]?.title, "B");
  const restored = switchAccountProject(switched, "project-a");
  assert.equal(restored.rawScript, "A SCRIPT");
  assert.equal(restored.episodes[0]?.title, "A");
});

test("account catalog makes empty projects visible before a content projection exists", () => {
  const local = projectData("flow-project-main", ["flow-project-main"]);
  const catalog = ["flow-project-one", "flow-project-two"].map((projectId, index) => ({
    projectId,
    title: `Cloud ${index + 1}`,
    color: "amber",
    durationMin: 90,
    rootNodeId: `root-${projectId}`,
    createdAt: index + 1,
    updatedAt: index + 10,
    hasDocument: false,
  }));
  const hydrated = hydrateCloudProjectCatalog(local, catalog, []);
  assert.deepEqual(hydrated.flowProjects?.map((project) => project.id), [
    "flow-project-one",
    "flow-project-two",
  ]);
  assert.equal(hydrated.activeFlowProjectId, "flow-project-one");
});

test("node movement is recognized and applied as an action-level sync patch", () => {
  const previous = projectData("project-a", ["project-a"]);
  previous.flowProjects![0].flow.flowNodes = [{
    id: "node-a",
    type: "text",
    position: { x: 1, y: 2 },
    data: { markdown: "unchanged" },
  } as any];
  previous.flow = previous.flowProjects![0].flow;
  const next = {
    ...previous,
    flow: {
      ...previous.flow!,
      flowNodes: [{ ...previous.flow!.flowNodes![0], position: { x: 40, y: 50 } }],
    },
    flowProjects: [{
      ...previous.flowProjects![0],
      updatedAt: 99,
      flow: {
        ...previous.flowProjects![0].flow,
        flowNodes: [{
          ...previous.flowProjects![0].flow.flowNodes![0],
          position: { x: 40, y: 50 },
        }],
      },
    }],
  };
  const patches = [{ nodeId: "node-a", position: { x: 40, y: 50 } }];
  assert.equal(isNodeGeometryOnlyProjectChange(previous, next, "project-a", patches), true);
  const patched = patchProjectSyncSnapshotGeometry(previous, next, "project-a", patches);
  assert.deepEqual(patched.flowProjects?.[0].flow.flowNodes?.[0].position, { x: 40, y: 50 });
  assert.equal(patched.flowProjects?.[0].flow.flowNodes?.[0].data.markdown, "unchanged");
});

test("epoch rebasing keeps an offline local field and an unrelated remote field", () => {
  const base = projectData("project-a", ["project-a"]);
  base.flowProjects![0].flow.flowNodes = [{
    id: "node-a",
    type: "text",
    position: { x: 1, y: 2 },
    data: { markdown: "base" },
  } as any];
  base.flow = base.flowProjects![0].flow;
  const local = structuredClone(base);
  local.flowProjects![0].flow.flowNodes![0].position = { x: 40, y: 50 };
  local.flow = local.flowProjects![0].flow;
  const remote = structuredClone(base);
  (remote.flowProjects![0].flow.flowNodes![0].data as any).markdown = "remote";
  remote.flow = remote.flowProjects![0].flow;

  const merged = mergeProjectSnapshotsAcrossEpoch(base, local, remote);
  assert.deepEqual(merged.flowProjects?.[0].flow.flowNodes?.[0].position, { x: 40, y: 50 });
  assert.equal((merged.flowProjects?.[0].flow.flowNodes?.[0].data as any).markdown, "remote");
});

test("resetting one project keeps every sibling project intact", () => {
  const local = projectData("project-a", ["project-a", "project-b"]);
  local.flowProjects![1].flow.revision = 7;
  const empty = projectData("empty-template", ["empty-template"]);
  const reset = resetStyloScopedProjectData(local, empty, "project-a");

  assert.deepEqual(reset.flowProjects?.map((item) => item.id), ["project-a", "project-b"]);
  assert.equal(reset.activeFlowProjectId, "project-a");
  assert.equal(reset.flowProjects?.find((item) => item.id === "project-a")?.flow.revision, 0);
  assert.equal(reset.flowProjects?.find((item) => item.id === "project-b")?.flow.revision, 7);
});

test("D1 authorities, realtime documents, Agent history, and assets have explicit project columns", () => {
  const migration = [
    read("migrations/0003_project_scoped_cloud.sql"),
    read("migrations/0004_realtime_collaboration.sql"),
    read("migrations/0009_account_project_catalog.sql"),
  ].join("\n");
  const compositePrimaryKeys = migration.match(/PRIMARY KEY \(user_id, project_id[^)]*\)/g) || [];
  assert.ok(compositePrimaryKeys.length >= 10);
  assert.match(migration, /CREATE TABLE agent_sessions[\s\S]*project_id TEXT NOT NULL/);
  assert.match(migration, /CREATE TABLE agent_traces[\s\S]*project_id TEXT NOT NULL/);
  assert.match(migration, /CREATE TABLE agent_spans[\s\S]*project_id TEXT NOT NULL/);
  assert.match(migration, /CREATE TABLE user_seedance_assets[\s\S]*PRIMARY KEY \(user_id, project_id, asset_id\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS user_project_documents[\s\S]*PRIMARY KEY \(user_id, project_id\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS user_project_catalog[\s\S]*PRIMARY KEY \(user_id, project_id\)/);
});

test("network and object storage operations carry and enforce projectId", () => {
  const realtime = read("sync/realtimeProjectSyncEngine.ts");
  const storageClient = read("node-workspace/nodeflow/storageObjects.ts");
  const upload = read("functions/api/upload-url.ts");
  const download = read("functions/api/download-url.ts");
  const deletion = read("functions/api/storage-objects.ts");

  assert.match(realtime, /projectId=\$\{encodeURIComponent\(this\.options\.projectId\)\}/);
  assert.match(storageClient, /JSON\.stringify\(\{ projectId, objects: uniqueObjects \}\)/);
  assert.match(upload, /users\/\$\{userId\}\/projects\/\$\{projectId\}\//);
  assert.match(upload, /fileSize required/);
  assert.match(upload, /MAX_PRIVATE_UPLOAD_BYTES = 64 \* 1024 \* 1024/);
  assert.match(upload, /MAX_PUBLIC_UPLOAD_BYTES = 20 \* 1024 \* 1024/);
  assert.match(upload, /ALLOWED_PUBLIC_CONTENT_TYPES/);
  assert.match(upload, /storage-upload-hour/);
  assert.match(storageClient, /fileSize: file\.size/);
  assert.match(download, /path\.startsWith\(projectPrefix\)/);
  assert.match(deletion, /path\.startsWith\(projectPrefix\)/);
});
