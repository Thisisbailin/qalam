import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyIncomingTextProjection,
  recordPendingTextEcho,
} from "../node-workspace/nodes/textProjection";

test("text projection ignores exact local echoes but adopts a merged remote value", () => {
  let pending = recordPendingTextEcho([], "OPEN LEFT");
  const echo = classifyIncomingTextProjection({
    incoming: "OPEN LEFT",
    draft: "OPEN LEFT",
    pendingLocalEchoes: pending,
  });
  assert.equal(echo.adopt, false);
  pending = echo.pendingLocalEchoes;

  pending = recordPendingTextEcho(pending, "OPEN LEFT AGAIN");
  const merged = classifyIncomingTextProjection({
    incoming: "OPEN LEFT AGAIN RIGHT",
    draft: "OPEN LEFT AGAIN",
    pendingLocalEchoes: pending,
  });
  assert.equal(merged.adopt, true);
  assert.deepEqual(merged.pendingLocalEchoes, []);
});

test("an older batched local echo cannot roll back a newer draft", () => {
  let pending = recordPendingTextEcho([], "A");
  pending = recordPendingTextEcho(pending, "AB");
  const projection = classifyIncomingTextProjection({
    incoming: "A",
    draft: "AB",
    pendingLocalEchoes: pending,
  });
  assert.equal(projection.adopt, false);
  assert.deepEqual(projection.pendingLocalEchoes, ["AB"]);
});
