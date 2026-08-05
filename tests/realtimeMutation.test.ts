import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mergeRealtimeMutations,
  parseRealtimeMutationEnvelope,
  validateRealtimeMutationEffect,
  type RealtimeNodeGeometryMutation,
  type RealtimeNodeTextMutation,
} from "../collaboration/realtimeMutation";

const mutation = (): RealtimeNodeGeometryMutation => ({
  version: 2,
  kind: "node.geometry",
  projectId: "project-main",
  updatedAt: 20,
  patches: [{ nodeId: "node-1", position: { x: 84, y: 20 } }],
});

const textMutation = (): RealtimeNodeTextMutation => ({
  version: 2,
  kind: "node.text",
  projectId: "project-main",
  updatedAt: 20,
  revision: 2,
  patches: [{ nodeId: "node-1", field: "text", derivedFields: ["atMentions"] }],
});

const project = (x: number, updatedAt = 10) => ({
  activeFlowProjectId: "project-main",
  flowProjects: [{
    id: "project-main",
    title: "Project",
    updatedAt,
    flow: {
      revision: 1,
      flowNodes: [{
        id: "node-1",
        type: "text",
        position: { x, y: 20 },
        data: { markdown: "hello", text: "OPEN", atMentions: [] },
      }],
      links: [],
    },
  }],
});

test("typed realtime geometry envelopes are closed, bounded, and project-scoped", () => {
  const parsed = parseRealtimeMutationEnvelope(mutation(), "project-main");
  assert.equal(parsed.ok, true);
  assert.equal(parseRealtimeMutationEnvelope({ ...mutation(), projectId: "project-other" }, "project-main").ok, false);
  assert.equal(parseRealtimeMutationEnvelope({ ...mutation(), surprise: true }, "project-main").ok, false);
  assert.equal(parseRealtimeMutationEnvelope({
    ...mutation(),
    patches: [
      { nodeId: "node-1", position: { x: 1, y: 2 } },
      { nodeId: "node-1", measured: { width: 10 } },
    ],
  }, "project-main").ok, false);
  assert.equal(parseRealtimeMutationEnvelope({
    ...mutation(),
    patches: [{ nodeId: "node-1", position: { x: Number.POSITIVE_INFINITY, y: 0 } }],
  }, "project-main").ok, false);
});

test("typed intent proves the exact Yjs materialized effect and rejects hidden changes", () => {
  const before = project(10);
  const after = project(84, 20);
  assert.deepEqual(validateRealtimeMutationEffect(before, after, mutation()), { ok: true });

  const hiddenChange = structuredClone(after);
  hiddenChange.flowProjects[0].flow.flowNodes[0].data.markdown = "hidden overwrite";
  assert.equal(validateRealtimeMutationEffect(before, hiddenChange, mutation()).ok, false);

  const missingNode = mutation();
  missingNode.patches[0].nodeId = "node-missing";
  assert.equal(validateRealtimeMutationEffect(before, after, missingNode).ok, false);
});

test("coalesced geometry intent keeps the newest field values and otherwise fails closed", () => {
  const first = mutation();
  first.patches = [{ nodeId: "node-1", position: { x: 30, y: 20 } }];
  const second = mutation();
  second.updatedAt = 30;
  second.patches = [
    { nodeId: "node-1", measured: { width: 220, height: 120 } },
    { nodeId: "node-2", position: { x: 50, y: 60 } },
  ];
  const merged = mergeRealtimeMutations(first, second);
  assert.equal(merged?.updatedAt, 30);
  assert.deepEqual(merged?.patches[0], {
    nodeId: "node-1",
    position: { x: 30, y: 20 },
    measured: { width: 220, height: 120 },
  });
  assert.equal(mergeRealtimeMutations(first, null), null);
});

test("typed text envelopes whitelist paths without transporting whole text snapshots", () => {
  assert.equal(parseRealtimeMutationEnvelope(textMutation(), "project-main").ok, true);
  assert.equal(parseRealtimeMutationEnvelope({ ...textMutation(), revision: -1 }, "project-main").ok, false);
  assert.equal(parseRealtimeMutationEnvelope({
    ...textMutation(),
    patches: [{ nodeId: "node-1", field: "title" }],
  }, "project-main").ok, false);
  assert.equal(parseRealtimeMutationEnvelope({
    ...textMutation(),
    patches: [{ nodeId: "node-1", field: "text", derivedFields: ["atMentions", "atMentions"] }],
  }, "project-main").ok, false);
  assert.equal(Object.hasOwn(textMutation().patches[0], "text"), false);
});

test("typed text effect permits only the declared Y.Text path and derived metadata", () => {
  const before = project(10);
  const after = project(10, 20);
  after.flowProjects[0].flow.revision = 2;
  after.flowProjects[0].flow.flowNodes[0].data.text = "OPEN LEFT";
  (after.flowProjects[0].flow.flowNodes[0].data as Record<string, unknown>).atMentions = ["left"];
  assert.deepEqual(validateRealtimeMutationEffect(before, after, textMutation()), { ok: true });

  const hidden = structuredClone(after);
  hidden.flowProjects[0].flow.flowNodes[0].data.markdown = "hidden overwrite";
  assert.equal(validateRealtimeMutationEffect(before, hidden, textMutation()).ok, false);

  const wrongRevision = structuredClone(after);
  wrongRevision.flowProjects[0].flow.revision = 3;
  assert.equal(validateRealtimeMutationEffect(before, wrongRevision, textMutation()).ok, false);
});

test("coalesced text intents retain every target path but mixed mutation kinds fail closed", () => {
  const first = textMutation();
  const second = textMutation();
  second.updatedAt = 30;
  second.revision = 3;
  second.patches = [
    { nodeId: "node-1", field: "text", derivedFields: ["entityBindings"] },
    { nodeId: "node-2", field: "text" },
  ];
  const merged = mergeRealtimeMutations(first, second);
  assert.equal(merged?.kind, "node.text");
  assert.equal(merged?.updatedAt, 30);
  assert.equal(merged?.kind === "node.text" ? merged.revision : -1, 3);
  assert.deepEqual(merged?.patches[0], {
    nodeId: "node-1",
    field: "text",
    derivedFields: ["atMentions", "entityBindings"],
  });
  assert.equal(mergeRealtimeMutations(first, mutation()), null);
});
