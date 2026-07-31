import assert from "node:assert/strict";
import { test } from "node:test";
import { resetD1UserData } from "../functions/api/account-data-reset";

const TABLES = [
  "agent_spans",
  "agent_traces",
  "agent_sessions",
  "user_seedance_assets",
  "user_project_documents",
  "user_project_catalog",
  "user_project_visibility",
  "user_project_deletions",
  "user_profile_visits",
  "user_sync_audit",
  "user_profile",
  "user_secrets",
];

const createDatabase = () => {
  const batches: Array<Array<{ sql: string; bindings: unknown[] }>> = [];
  let directRuns = 0;
  const prepare = (sql: string) => {
    const statement = {
      sql,
      bindings: [] as unknown[],
      bind(...bindings: unknown[]) {
        this.bindings = bindings;
        return this;
      },
      async all() {
        return { results: TABLES.map((name) => ({ name })) };
      },
      async run() {
        directRuns += 1;
        return { meta: { changes: 1 } };
      },
    };
    return statement;
  };
  const DB = {
    prepare,
    async batch(statements: Array<{ sql: string; bindings: unknown[] }>) {
      batches.push(statements);
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return { DB, batches, getDirectRuns: () => directRuns };
};

test("project reset deletes all project authority rows in one D1 batch", async () => {
  const database = createDatabase();
  const result = await resetD1UserData({ DB: database.DB } as any, "user-1", false, "project-a");

  assert.equal(database.batches.length, 1);
  assert.equal(database.getDirectRuns(), 0);
  const sql = database.batches[0].map((statement) => statement.sql).join("\n");
  assert.doesNotMatch(sql, /INSERT INTO user_project_write_guards/);
  assert.doesNotMatch(sql, /DELETE FROM user_project_write_guards/);
  assert.match(sql, /DELETE FROM user_seedance_assets/);
  assert.doesNotMatch(sql, /user_project_updates/);
  assert.match(sql, /DELETE FROM user_project_documents/);
  assert.doesNotMatch(sql, /DELETE FROM user_project_catalog/);
  assert.match(sql, /DELETE FROM user_project_visibility/);
  assert.doesNotMatch(sql, /DELETE FROM user_project_deletions/);
  assert.match(sql, /DELETE FROM user_profile_visits WHERE owner_user_id/);
  assert.match(sql, /DELETE FROM agent_sessions/);
  assert.doesNotMatch(sql, /DELETE FROM user_profile WHERE/);
  assert.doesNotMatch(sql, /DELETE FROM user_secrets/);
  const projectDeletes = database.batches[0].filter((statement) => /DELETE FROM (?!user_project_write_guards)/.test(statement.sql));
  assert.ok(projectDeletes.every((statement) => statement.bindings[0] === "user-1"));
  assert.ok(projectDeletes.every((statement) => statement.bindings[1] === "project-a"));
  assert.ok(projectDeletes.every((statement) => /project_id = \?2/.test(statement.sql)));
  assert.equal(result.user_project_documents, 1);
  assert.equal(result.user_profile_visits_inbound, 1);
});

test("account reset extends the same transaction to profile, traces, and secrets", async () => {
  const database = createDatabase();
  const result = await resetD1UserData({ DB: database.DB } as any, "user-2", true);

  assert.equal(database.batches.length, 1);
  const sql = database.batches[0].map((statement) => statement.sql).join("\n");
  assert.match(sql, /DELETE FROM user_profile/);
  assert.match(sql, /DELETE FROM user_secrets/);
  assert.match(sql, /DELETE FROM user_project_documents/);
  assert.match(sql, /DELETE FROM user_project_catalog/);
  assert.match(sql, /DELETE FROM user_project_visibility/);
  assert.doesNotMatch(sql, /DELETE FROM user_project_deletions/);
  assert.match(sql, /DELETE FROM user_profile_visits WHERE viewer_user_id/);
  assert.doesNotMatch(sql, /user_project_edit_leases/);
  assert.equal(result.user_profile_visits_inbound, 1);
  assert.equal(result.user_profile_visits_outbound, 1);
});
