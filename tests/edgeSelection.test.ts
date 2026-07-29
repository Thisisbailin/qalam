import assert from "node:assert/strict";
import test from "node:test";
import { applyEdgeSelectionUpdates } from "../node-workspace/nodeflow/edgeSelection";

test("edge selection remains controlled across select, deselect, and removal updates", () => {
  const first = applyEdgeSelectionUpdates(new Set(), [
    { id: "edge-a", selected: true },
  ]);
  assert.deepEqual(Array.from(first), ["edge-a"]);

  const second = applyEdgeSelectionUpdates(first, [
    { id: "edge-b", selected: true },
    { id: "edge-a", selected: false },
  ]);
  assert.deepEqual(Array.from(second), ["edge-b"]);

  const third = applyEdgeSelectionUpdates(second, [
    { id: "edge-b", removed: true },
  ]);
  assert.equal(third.size, 0);
});

test("edge selection reducer preserves identity for no-op updates", () => {
  const selected = new Set(["edge-a"]);
  assert.equal(
    applyEdgeSelectionUpdates(selected, [{ id: "edge-a", selected: true }]),
    selected
  );
  assert.equal(applyEdgeSelectionUpdates(selected, []), selected);
});
