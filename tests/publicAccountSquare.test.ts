import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { INITIAL_PROJECT_DATA } from "../constants";
import { readProjectVisibility, normalizeUsername } from "../functions/api/_publicAccess";
import {
  createAccountProject,
  createAccountProjectId,
  removeAccountProject,
  switchAccountProject,
  updateAccountProject,
} from "../utils/accountProjects";

const read = (path: string) => readFileSync(path, "utf8");

test("public account schema separates profile, project visibility, and authenticated traces", () => {
  const migration = read("migrations/0005_public_account_square.sql");
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profile_normalized_username/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS user_project_visibility/);
  assert.match(migration, /PRIMARY KEY \(user_id, project_id\)/);
  assert.match(migration, /CHECK \(visibility IN \('inherit', 'public', 'private'\)\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS user_profile_visits/);
  assert.match(migration, /viewer_user_id TEXT NOT NULL/);
  assert.match(migration, /owner_user_id TEXT NOT NULL/);
  assert.match(migration, /visit_session_id TEXT NOT NULL/);
  assert.match(migration, /CHECK \(viewer_user_id <> owner_user_id\)/);
});

test("public access requires auth, applies visibility on the server, and leaves a trace", () => {
  const directory = read("functions/api/public-directory.ts");
  const profile = read("functions/api/public-profile.ts");
  const project = read("functions/api/public-project.ts");
  const realtime = read("functions/api/public-project-realtime.ts");
  const traces = read("functions/api/view-traces.ts");

  for (const source of [directory, profile, project, traces]) {
    assert.match(source, /getUserId\(/);
  }
  assert.match(realtime, /consumeRealtimeTicket/);
  assert.match(project, /readProjectVisibility/);
  assert.match(realtime, /readProjectVisibility/);
  assert.match(profile, /recordProfileVisit/);
  assert.match(project, /recordProfileVisit/);
  assert.match(realtime, /x-stylo-access-mode", "view"/);
  assert.match(traces, /viewer_user_id/);
  assert.match(traces, /owner_user_id/);
});

test("Durable Object attachments make public sockets read-only while preserving edit sockets", () => {
  const room = read("realtime-worker/src/index.ts");
  const editGateway = read("functions/api/project-realtime.ts");
  const publication = read("functions/api/publication.ts");
  assert.match(room, /type RoomAccess = "edit" \| "view"/);
  assert.match(room, /server\.serializeAttachment\(\{ userId, projectId, access, viewerUserId \}\)/);
  assert.match(room, /attachedIdentity\.access !== "edit"/);
  assert.match(room, /Public project connections are read-only/);
  assert.match(room, /revoke-viewers/);
  assert.match(room, /Project visibility changed/);
  assert.match(room, /!accessHeader \? userId/);
  assert.match(editGateway, /x-stylo-access-mode", "edit"/);
  assert.match(publication, /revokeProjectViewers/);
});

test("account workspace owns project hierarchy and the user square entry", () => {
  const workspace = read("node-workspace/components/AccountWorkspace.tsx");
  const actionBar = read("node-workspace/components/FloatingActionBar.tsx");
  const foundation = read("node-workspace/components/FlowSurface.tsx");
  assert.match(workspace, /Account projects/);
  assert.match(workspace, /用户广场/);
  assert.match(workspace, /正在看我/);
  assert.match(workspace, /我看过的/);
  assert.match(workspace, /登录邮箱/);
  assert.match(workspace, /项目公开范围/);
  assert.match(workspace, /项目默认跟随此设置/);
  assert.doesNotMatch(workspace, /显示名称/);
  assert.match(actionBar, /onOpenAccountWorkspace/);
  assert.match(actionBar, /onOpenUserSquare/);
  assert.doesNotMatch(foundation, /script-foundation-gateway__section--projects/);
  assert.doesNotMatch(foundation, /onOpenAccountWorkspace|onOpenUserSquare/);
  assert.match(foundation, /script-foundation-gateway-card--index/);
});

test("username and project visibility rules are deterministic", async () => {
  assert.equal(normalizeUsername("  Film.Editor-7  "), "film.editor-7");
  assert.equal(normalizeUsername("ab"), "");
  assert.equal(normalizeUsername("bad name"), "");

  const makeDb = (account: string, override: string | null) => ({
    prepare: () => ({
      bind: () => ({
        first: async () => ({ account_visibility: account, visibility: override }),
      }),
    }),
  });
  assert.equal((await readProjectVisibility(makeDb("private", "public"), "owner", "project")).visible, true);
  assert.equal((await readProjectVisibility(makeDb("public", "private"), "owner", "project")).visible, false);
  assert.equal((await readProjectVisibility(makeDb("public", null), "owner", "project")).visible, true);
  assert.equal((await readProjectVisibility(makeDb("private", null), "owner", "project")).visible, false);
});

test("account project operations preserve a single active project boundary", () => {
  const initial = structuredClone(INITIAL_PROJECT_DATA);
  const stableProjectId = createAccountProjectId();
  const created = createAccountProject(initial, {
    projectId: stableProjectId,
    title: "夜航",
    durationMin: 87,
  });
  const createdId = created.activeFlowProjectId!;
  assert.equal(createdId, stableProjectId);
  assert.equal(created.flowProjects?.length, 2);
  assert.equal(created.flowProjects?.find((item) => item.id === createdId)?.title, "夜航");

  const repeatedSubmission = createAccountProject(created, {
    projectId: stableProjectId,
    title: "夜航",
    durationMin: 87,
  });
  assert.equal(repeatedSubmission.flowProjects?.length, 2);
  assert.equal(repeatedSubmission.flowProjects?.filter((item) => item.id === stableProjectId).length, 1);

  const renamed = updateAccountProject(created, createdId, { title: "夜航修订", durationMin: 91 });
  assert.equal(renamed.flowProjects?.find((item) => item.id === createdId)?.durationMin, 91);
  assert.equal(renamed.fileName, "夜航修订");

  const firstId = renamed.flowProjects?.[0].id!;
  const switched = switchAccountProject(renamed, firstId);
  assert.equal(switched.activeFlowProjectId, firstId);
  assert.deepEqual(switched.flow, switched.flowProjects?.find((item) => item.id === firstId)?.flow);

  const removed = removeAccountProject(switched, createdId);
  assert.equal(removed.flowProjects?.length, 1);
  assert.equal(removed.flowProjects?.[0].id, firstId);
});
