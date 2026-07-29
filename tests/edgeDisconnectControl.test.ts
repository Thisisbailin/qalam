import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("selected Flow edges expose the shared disconnect control", async () => {
  const root = process.cwd();
  const edge = await readFile(
    path.join(root, "node-workspace/edges/DisconnectableEdge.tsx"),
    "utf8"
  );
  const flowSurface = await readFile(
    path.join(root, "node-workspace/components/FlowSurface.tsx"),
    "utf8"
  );
  const wrapperEdge = await readFile(
    path.join(root, "node-workspace/edges/WrapperMembershipEdge.tsx"),
    "utf8"
  );
  const styles = await readFile(
    path.join(root, "node-workspace/styles/nodeflow.css"),
    "utf8"
  );

  assert.match(edge, /if \(!selected \|\| deletable === false\) return null/);
  assert.match(edge, /deleteElements\(\{ edges: \[\{ id: edgeId \}\] \}\)/);
  assert.match(edge, /<LinkBreak/);
  assert.match(edge, /aria-label="断开连接"/);
  assert.match(flowSurface, /disconnectable: DisconnectableEdge/);
  assert.match(flowSurface, /"wrapperMembership" : "disconnectable"/);
  assert.equal(flowSurface.match(/<EdgeDisconnectControl/g)?.length, 1);
  assert.equal(wrapperEdge.match(/<EdgeDisconnectControl/g)?.length, 1);
  assert.match(flowSurface, /selectedEdgeIds[\s\S]*selected: selectedEdgeIds\.has\(link\.id\)/);
  assert.match(flowSurface, /selectionChanges[\s\S]*setSelectedEdgeIds/);
  assert.match(wrapperEdge, /getBezierPath\([\s\S]*curvature: 0\.28/);
  assert.match(flowSurface, /getFixedFlowNodeDimensions[\s\S]*measured: fixedDimensions \|\| sanitizeScriptMeasured/);
  assert.match(styles, /\.react-flow__edge-interaction \{[\s\S]*stroke-width: 28px;[\s\S]*pointer-events: stroke;/);
  assert.match(styles, /\.flow-edge-disconnect \{[\s\S]*width: 26px;[\s\S]*pointer-events: all;/);
  assert.match(styles, /\.react-flow__handle-left \{\s*transform: translate\(-50%, -50%\);/);
  assert.match(styles, /\.react-flow__handle-right \{\s*transform: translate\(50%, -50%\);/);
  assert.doesNotMatch(styles, /\.react-flow__node:hover \.react-flow__handle-(?:left|right) \{[^}]*transform:/);
});
