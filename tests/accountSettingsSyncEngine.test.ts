import assert from "node:assert/strict";
import { test } from "node:test";
import { AccountSettingsSyncEngine } from "../sync/accountSettingsSyncEngine";
import type { AccountApiSession } from "../sync/authenticatedFetch";
import type { SecretsPayload } from "../sync/secretsSyncAdapter";
import type { SyncStatus } from "../types";

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const emptySecrets: SecretsPayload = {
  textApiKey: "",
  multiApiKey: "",
  videoApiKey: "",
};

test("a transient account-settings write failure retains and retries the local edit", async () => {
  let putCount = 0;
  const session = {
    request: async (path: string, init: RequestInit = {}) => {
      if (path !== "/api/secrets") throw new Error(`Unexpected path: ${path}`);
      if ((init.method || "GET") === "GET") {
        return Response.json({ secrets: emptySecrets, updatedAt: 1 });
      }
      putCount += 1;
      if (putCount === 1) throw new Error("temporary network failure");
      return Response.json({ ok: true, updatedAt: 2 });
    },
  } as unknown as AccountApiSession;
  const statuses: SyncStatus[] = [];
  const engine = new AccountSettingsSyncEngine({
    session,
    debounceMs: 0,
    onApplyRemote: () => undefined,
    onStatusChange: (status) => statuses.push(status),
    onError: () => undefined,
  });

  await engine.start(emptySecrets);
  const edited: SecretsPayload = {
    ...emptySecrets,
    textApiKey: "local-secret",
  };
  engine.stage(edited);
  await wait(10);

  assert.equal(putCount, 1);
  assert.deepEqual((engine as any).staged, edited);
  assert.ok(statuses.includes("error"));

  engine.setOnline(false);
  engine.setOnline(true);
  await wait(10);

  assert.equal(putCount, 2);
  assert.equal((engine as any).staged, null);
  assert.equal(statuses.at(-1), "synced");
  engine.dispose();
});

test("account-settings bootstrap retries on a reconnect event instead of staying unready", async () => {
  let getCount = 0;
  const session = {
    request: async () => {
      getCount += 1;
      if (getCount === 1) throw new Error("temporary bootstrap failure");
      return Response.json({ secrets: emptySecrets, updatedAt: 1 });
    },
  } as unknown as AccountApiSession;
  const statuses: SyncStatus[] = [];
  const engine = new AccountSettingsSyncEngine({
    session,
    debounceMs: 0,
    onApplyRemote: () => undefined,
    onStatusChange: (status) => statuses.push(status),
    onError: () => undefined,
  });

  await assert.rejects(engine.start(emptySecrets), /temporary bootstrap failure/);
  assert.equal((engine as any).ready, false);
  engine.setOnline(false);
  engine.setOnline(true);
  await wait(10);

  assert.equal(getCount, 2);
  assert.equal((engine as any).ready, true);
  assert.equal(statuses.at(-1), "synced");
  engine.dispose();
});
