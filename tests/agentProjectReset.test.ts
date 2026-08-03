import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildStyloAccountSessionId,
  buildStyloAccountStorageKeys,
} from "../agents/runtime/projectScope";
import { resetStyloProjectAgentStorage } from "../agents/runtime/projectReset";
import { DEFAULT_AGENT_SESSION_STORAGE_KEY } from "../agents/runtime/session";
import {
  resetNodeFlowProjectState,
  useNodeFlowStore,
} from "../node-workspace/store/nodeFlowStore";
import {
  DEFAULT_TIMELINE_DURATION,
  ensureFoundationGraphSkeleton,
} from "../node-workspace/foundation/scaffold";
import { isProjectEmpty } from "../utils/persistence";
import { normalizeProjectData } from "../utils/projectData";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

test("project reset returns the live Flow to revision zero and invalidates stale runs", () => {
  const generation = useNodeFlowStore.getState().accountGeneration;
  useNodeFlowStore.setState({
    revision: 42,
    nodes: [{ id: "text-1" } as any],
    links: [{ id: "link-1" } as any],
    graphLinks: [{ id: "graph-1" } as any],
    viewport: { x: 10, y: 20, zoom: 2 },
    appConfig: { textConfig: { model: "preserved" } },
    availableImageModels: ["image-model"],
  });

  resetNodeFlowProjectState();
  const reset = useNodeFlowStore.getState();
  assert.equal(reset.revision, 0);
  assert.equal(reset.accountGeneration, generation + 1);
  assert.deepEqual(reset.nodes, []);
  assert.deepEqual(reset.links, []);
  assert.deepEqual(reset.graphLinks, []);
  assert.equal(reset.viewport, null);
  assert.deepEqual(reset.appConfig, { textConfig: { model: "preserved" } });
  assert.deepEqual(reset.availableImageModels, ["image-model"]);
});

test("initializing the system Foundation scaffold does not consume a project revision", () => {
  const descriptor = {
    rootNodeId: "project-root-flow-project-main",
    title: "主项目",
    durationMin: DEFAULT_TIMELINE_DURATION,
  };
  const initialized = ensureFoundationGraphSkeleton({
    revision: 0,
    flowNodes: [],
    links: [],
    graphLinks: [],
    globalAssetHistory: [],
    linkStyle: "curved",
    activeView: null,
  }, descriptor);
  assert.equal(initialized.revision, 0);
  assert.ok((initialized.flowNodes || []).length > 0);
  assert.strictEqual(
    ensureFoundationGraphSkeleton(initialized, descriptor),
    initialized,
    "a settled Foundation skeleton must be referentially idempotent",
  );
  const normalized = normalizeProjectData({
    fileName: "主项目",
    rawScript: "",
    episodes: [],
    roles: [],
    designAssets: [],
    canvas: {},
    flow: initialized,
    activeFlowProjectId: "flow-project-main",
    flowProjects: [{
      id: "flow-project-main",
      title: "主项目",
      color: "amber",
      durationMin: DEFAULT_TIMELINE_DURATION,
      rootNodeId: descriptor.rootNodeId,
      createdAt: 1,
      updatedAt: 1,
      flow: initialized,
    }],
    stats: { context: { total: 0, success: 0, error: 0 } },
  });
  assert.strictEqual(
    ensureFoundationGraphSkeleton(normalized.flow!, descriptor),
    normalized.flow,
    "project normalization must not create a Foundation repair loop",
  );
  assert.equal(isProjectEmpty({
    fileName: "",
    rawScript: "",
    episodes: [],
    roles: [],
    designAssets: [],
    canvas: {},
    flow: initialized,
    activeFlowProjectId: "flow-project-main",
    flowProjects: [],
    stats: { context: { total: 0, success: 0, error: 0 } },
  }), true);
});

test("Foundation migration removes legacy character and scene axes without deleting member nodes", () => {
  const descriptor = {
    rootNodeId: "project-root-flow-project-main",
    title: "主项目",
    durationMin: DEFAULT_TIMELINE_DURATION,
  };
  const initialized = ensureFoundationGraphSkeleton({
    revision: 0,
    flowNodes: [],
    links: [],
    graphLinks: [],
    globalAssetHistory: [],
    linkStyle: "curved",
    activeView: null,
  }, descriptor);
  const characterAxisId = `${descriptor.rootNodeId}--character-axis`;
  const characterBlockId = `${descriptor.rootNodeId}--character-block-1`;
  const characterArchiveId = `${characterBlockId}--archive`;
  const memberId = "image-character-reference";
  const legacyFlow = {
    ...initialized,
    flowNodes: [
      ...(initialized.flowNodes || []),
      {
        id: characterAxisId,
        type: "folder",
        position: { x: 80, y: 1300 },
        data: { title: "角色轴", foundationRole: "axis-folder", foundationAxis: "character" },
      },
      {
        id: characterBlockId,
        type: "folder",
        position: { x: 360, y: 1540 },
        data: { title: "角色 1", foundationRole: "block-folder", foundationAxis: "character" },
      },
      {
        id: characterArchiveId,
        type: "mdText",
        position: { x: 630, y: 1522 },
        data: { title: "角色 1档案.md", foundationRole: "block-document", foundationAxis: "character" },
      },
      {
        id: memberId,
        type: "imageInput",
        position: { x: 980, y: 1540 },
        data: { title: "角色参考", foundationContainerId: characterBlockId },
      },
    ] as any,
    links: [
      ...initialized.links,
      { id: "legacy-root-axis", source: descriptor.rootNodeId, target: characterAxisId },
      { id: "legacy-axis-block", source: characterAxisId, target: characterBlockId },
      { id: "legacy-block-archive", source: characterBlockId, target: characterArchiveId },
      { id: "legacy-block-member", source: characterBlockId, target: memberId },
    ],
  };

  const migrated = ensureFoundationGraphSkeleton(legacyFlow, descriptor);
  const migratedNodeIds = new Set((migrated.flowNodes || []).map((node) => node.id));
  assert.equal(migratedNodeIds.has(characterAxisId), false);
  assert.equal(migratedNodeIds.has(characterBlockId), false);
  assert.equal(migratedNodeIds.has(characterArchiveId), false);
  assert.equal(migratedNodeIds.has(memberId), true);
  assert.equal(
    (migrated.flowNodes || []).find((node) => node.id === memberId)?.data?.foundationContainerId,
    undefined,
  );
  assert.equal(migrated.links.some((link) => link.source === characterBlockId || link.target === characterBlockId), false);
  assert.strictEqual(ensureFoundationGraphSkeleton(migrated, descriptor), migrated);
});

test("project reset clears only the matching account and project Agent memory", () => {
  const storage = new MemoryStorage();
  const accountScope = "user:reset-owner";
  const projectId = "flow-project-main";
  const otherAccount = "user:other-owner";
  const keys = buildStyloAccountStorageKeys(accountScope, projectId);
  const otherKeys = buildStyloAccountStorageKeys(otherAccount, projectId);
  const matchingSession = buildStyloAccountSessionId(accountScope, projectId, "chat-1");
  const otherSession = buildStyloAccountSessionId(otherAccount, projectId, "chat-1");

  storage.setItem(keys.conversationStorageKey, "old conversation");
  storage.setItem(keys.activityStorageKey, "old activity");
  storage.setItem(otherKeys.conversationStorageKey, "other conversation");
  storage.setItem(DEFAULT_AGENT_SESSION_STORAGE_KEY, JSON.stringify({
    [matchingSession]: { id: matchingSession, items: [], messages: [], updatedAt: 1 },
    [otherSession]: { id: otherSession, items: [], messages: [], updatedAt: 1 },
  }));

  const result = resetStyloProjectAgentStorage(accountScope, projectId, storage);
  assert.equal(result.clearedLocalSessions, 1);
  assert.equal(storage.getItem(keys.conversationStorageKey), null);
  assert.equal(storage.getItem(keys.activityStorageKey), "{}");
  assert.equal(storage.getItem(otherKeys.conversationStorageKey), "other conversation");
  const remainingSessions = JSON.parse(storage.getItem(DEFAULT_AGENT_SESSION_STORAGE_KEY) || "{}");
  assert.equal(matchingSession in remainingSessions, false);
  assert.equal(otherSession in remainingSessions, true);
});
