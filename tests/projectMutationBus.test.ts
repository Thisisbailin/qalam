import assert from "node:assert/strict";
import { test } from "node:test";
import { useNodeFlowStore } from "../node-workspace/store/nodeFlowStore";
import {
  subscribeProjectNodeTextMutations,
  type ProjectNodeTextMutation,
} from "../sync/projectMutationBus";

test("the real NodeFlow text write publishes a project-scoped contiguous intent", () => {
  const previousState = useNodeFlowStore.getState();
  const mutations: ProjectNodeTextMutation[] = [];
  const unsubscribe = subscribeProjectNodeTextMutations((mutation) => mutations.push(mutation));
  try {
    useNodeFlowStore.setState({
      ...previousState,
      revision: 1,
      nodeFlowContext: {
        projectId: "project-main",
        rawScript: "",
        episodes: [],
        designAssets: [],
        roles: [],
      },
      nodes: [{
        id: "node-1",
        type: "text",
        position: { x: 0, y: 0 },
        data: { text: "OPEN", atMentions: [], entityBindings: [] },
      } as any],
    });
    useNodeFlowStore.getState().updateNodeData("node-1", {
      text: "OPEN LEFT",
      atMentions: ["left"],
      entityBindings: [],
    } as any);
    assert.deepEqual(mutations, [{
      projectId: "project-main",
      nodeId: "node-1",
      previousText: "OPEN",
      nextText: "OPEN LEFT",
      derivedFields: ["atMentions", "entityBindings"],
    }]);
  } finally {
    unsubscribe();
    useNodeFlowStore.setState(previousState, true);
  }
});
