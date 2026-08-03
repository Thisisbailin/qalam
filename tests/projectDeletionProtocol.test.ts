import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createProjectDeletionCapability,
  hashProjectDeletionCapability,
  normalizeProjectDeletionQueueMessage,
} from "../collaboration/projectDeletionProtocol";

test("project deletion queue capabilities are opaque and stored as hashes", async () => {
  const capability = createProjectDeletionCapability();
  const other = createProjectDeletionCapability();
  assert.match(capability, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(capability, other);
  const hash = await hashProjectDeletionCapability(capability);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, capability);
});

test("project deletion queue messages reject malformed ids and capabilities", () => {
  const capability = "a".repeat(43);
  assert.deepEqual(normalizeProjectDeletionQueueMessage({
    jobId: "123e4567-e89b-42d3-a456-426614174000",
    capability,
  }), {
    jobId: "123e4567-e89b-42d3-a456-426614174000",
    capability,
  });
  assert.equal(normalizeProjectDeletionQueueMessage({
    jobId: "../../../another-job",
    capability,
  }), null);
  assert.equal(normalizeProjectDeletionQueueMessage({
    jobId: "123e4567-e89b-42d3-a456-426614174000",
    capability: "too-short",
  }), null);
});
