import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRealtimeProjectSnapshot } from "../collaboration/realtimeProjectValidation";

const validProject = () => ({
  activeFlowProjectId: "project-main",
  episodes: [],
  roles: [],
  designAssets: [],
  flowProjects: [{
    id: "project-main",
    flow: {
      revision: 1,
      flowNodes: [{
        id: "node-1",
        type: "text",
        position: { x: 0, y: 0 },
        data: { markdown: "hello" },
      }],
      links: [],
      graphLinks: [],
      globalAssetHistory: [],
    },
  }],
});

test("realtime authority accepts a bounded project scoped to its room", () => {
  assert.deepEqual(
    validateRealtimeProjectSnapshot(validProject(), "project-main"),
    { ok: true },
  );
  assert.deepEqual(validateRealtimeProjectSnapshot({}, "project-main"), { ok: true });
});

test("realtime authority rejects cross-project and unsafe candidate state", () => {
  const crossProject = validProject();
  crossProject.activeFlowProjectId = "project-other";
  assert.equal(validateRealtimeProjectSnapshot(crossProject, "project-main").ok, false);

  const unsafe = validProject() as Record<string, unknown>;
  Object.defineProperty(unsafe, "__proto__", { value: "unsafe", enumerable: true });
  assert.equal(validateRealtimeProjectSnapshot(unsafe, "project-main").ok, false);
});

test("realtime authority rejects missing graph endpoints and parent cycles", () => {
  const missingEndpoint = validProject();
  missingEndpoint.flowProjects[0].flow.links.push({
    id: "link-1",
    source: "node-1",
    target: "node-missing",
  } as never);
  assert.equal(validateRealtimeProjectSnapshot(missingEndpoint, "project-main").ok, false);

  const cycle: any = validProject();
  cycle.flowProjects[0].flow.flowNodes = [
    { id: "node-1", type: "text", position: { x: 0, y: 0 }, data: { markdown: "" }, parentId: "node-2" },
    { id: "node-2", type: "text", position: { x: 0, y: 0 }, data: { markdown: "" }, parentId: "node-1" },
  ];
  assert.equal(validateRealtimeProjectSnapshot(cycle, "project-main").ok, false);
});
