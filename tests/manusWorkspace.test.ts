import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("Manus presents hidden floating tools, connected pages, and a LookBook identity rail", async () => {
  const root = process.cwd();
  const chrome = await readFile(
    path.join(root, "node-workspace/components/screenplay/ScreenplayChrome.tsx"),
    "utf8"
  );
  const writingPanel = await readFile(
    path.join(root, "node-workspace/components/WritingPanel.tsx"),
    "utf8"
  );
  const blockEditor = await readFile(
    path.join(root, "node-workspace/components/screenplay/ScreenplayBlockEditor.tsx"),
    "utf8"
  );
  const workspace = await readFile(
    path.join(root, "node-workspace/components/CreativeWorkspace.tsx"),
    "utf8"
  );
  const styles = await readFile(
    path.join(root, "node-workspace/styles/screenplay.css"),
    "utf8"
  );

  assert.doesNotMatch(chrome, /screenplay-header__bookmark/);
  assert.match(chrome, /screenplay-header__hot-zone/);
  assert.match(chrome, /screenplay-identity-dock__rail/);
  assert.match(chrome, /screenplay-identity-dock__surface/);
  assert.doesNotMatch(chrome, /layout[\s\S]*className="screenplay-identity-dock__surface"/);
  assert.match(chrome, /<CaretDown/);
  assert.match(chrome, /ScreenplayIdentityDock/);
  assert.match(chrome, /entry\.role\.kind === "person"/);
  assert.match(chrome, /entry\.role\.kind === "scene"/);
  assert.match(chrome, /打开 \$\{name\} 的 LookBook/);
  assert.match(writingPanel, /node\.type !== "identityCard" && node\.type !== "lookbook"/);
  assert.match(writingPanel, /identityArrivalQueue/);
  assert.match(writingPanel, /pendingIdentityRemovalId/);
  assert.match(writingPanel, /agentDockWidth > 0 \? "is-agent-open"/);
  assert.match(writingPanel, /剧本中已无引用/);
  assert.match(writingPanel, /getConnectedScriptPageSequence/);
  assert.match(writingPanel, /onSplitScriptDocument/);
  assert.match(writingPanel, /screenplay-title-page__fields/);
  assert.match(writingPanel, /ensureScreenplayTitlePage/);
  assert.match(writingPanel, /parseFountainTitlePage/);
  assert.match(writingPanel, /createBlankScreenplayPageBody/);
  assert.match(writingPanel, /<Reorder\.Group/);
  assert.match(writingPanel, /onReorderScriptDocuments/);
  assert.match(writingPanel, /paperLines[\s\S]*analyzeFountainLines/);
  assert.match(writingPanel, /readOnly=\{!isActive \|\| !!pendingPatch\}/);
  assert.doesNotMatch(writingPanel, /screenplay-document__preview/);
  assert.match(writingPanel, /Scissors[\s\S]*Copy[\s\S]*Clipboard[\s\S]*TextStrikethrough[\s\S]*ChatCenteredDots/);
  assert.match(writingPanel, /selectionCommand\.isAsking/);
  assert.match(writingPanel, /block: pageArrangement === "vertical" \? "start" : "center"/);
  assert.match(writingPanel, /commitDraft\(draftRef\.current, true\);[\s\S]*onOpenLookbook/);
  assert.match(workspace, /onOpenLookbook=\{\(identityNodeId\) => \{[\s\S]*setEditingScriptNodeId\(null\);[\s\S]*setActiveLookbookNodeId\(identityNodeId\);/);
  assert.match(workspace, /getConnectedScriptPageSequence\(previous, nodeId\)/);
  assert.match(styles, /\.screenplay-header \{[\s\S]*display: block;/);
  assert.match(styles, /\.screenplay-document \{[\s\S]*border-radius: 7px;/);
  assert.match(styles, /--screenplay-paper: #ffffff/);
  assert.doesNotMatch(styles, /\.screenplay-cover__binding/);
  assert.match(styles, /\.screenplay-title-page__fields/);
  assert.match(styles, /\.screenplay-block\.is-empty/);
  assert.match(styles, /appearance: none;/);
  assert.match(styles, /\.screenplay-page-filmstrip__pages > li\.is-dragging/);
  assert.match(styles, /\.screenplay-workspace \{[\s\S]*background: transparent;/);
  assert.match(styles, /\.screenplay-document-viewport \{[\s\S]*background: transparent;/);
  assert.match(styles, /\.screenplay-header \{[\s\S]*right: -54px;/);
  assert.match(styles, /\.screenplay-identity-dock__rail \{/);
  assert.match(styles, /\.screenplay-identity-dock__rail > button \{[\s\S]*background:/);
  assert.match(styles, /\.screenplay-identity-dock\.is-open \.screenplay-identity-dock__surface \{[\s\S]*width: 286px;/);
  assert.match(styles, /\.screenplay-workspace\.is-agent-open \.screenplay-document-stage\.is-vertical/);
  assert.match(styles, /\.screenplay-workspace\.is-agent-open \.screenplay-document-stage\.is-vertical \{[\s\S]*padding-right: 62px;/);
  assert.match(styles, /\.screenplay-document-stage\.is-vertical \{[\s\S]*gap: 12px;/);
  assert.match(styles, /\.screenplay-selection-command\.is-asking/);
  assert.match(styles, /\.screenplay-identity-removal \{[\s\S]*border-radius: 999px;/);
  assert.match(styles, /scrollbar-width: none;/);
  assert.match(styles, /\.screenplay-document-stage\.is-focus \{/);
  assert.match(styles, /\.screenplay-workspace\.is-focus-mode \.screenplay-document \{[\s\S]*background: transparent;[\s\S]*box-shadow: none;/);
  assert.match(writingPanel, /isFocusMode[\s\S]*contentPages[\s\S]*pageArrangement === "vertical"[\s\S]*displayPages/);
  assert.match(writingPanel, /pageArrangement === "vertical"[\s\S]*filter\(\(node\) => node\.id === scriptNode\?\.id\)/);
  assert.match(writingPanel, /titlePageNode \? \[titlePageNode\.id, \.\.\.nextOrder\] : nextOrder/);
  assert.match(blockEditor, /mergeScreenplayLineWithPrevious/);
  assert.match(blockEditor, /event\.key !== "Tab"/);
  assert.doesNotMatch(blockEditor, /\^\[1-6\]\$/);
});

test("Manus owns screenplay creation and offers continuous paper layouts", async () => {
  const root = process.cwd();
  const flowSurface = await readFile(
    path.join(root, "node-workspace/components/FlowSurface.tsx"),
    "utf8"
  );
  const workspace = await readFile(
    path.join(root, "node-workspace/components/CreativeWorkspace.tsx"),
    "utf8"
  );
  const chrome = await readFile(
    path.join(root, "node-workspace/components/screenplay/ScreenplayChrome.tsx"),
    "utf8"
  );
  const writingPanel = await readFile(
    path.join(root, "node-workspace/components/WritingPanel.tsx"),
    "utf8"
  );
  const screenplayStyles = await readFile(
    path.join(root, "node-workspace/styles/screenplay.css"),
    "utf8"
  );
  const nodeflowStyles = await readFile(
    path.join(root, "node-workspace/styles/nodeflow.css"),
    "utf8"
  );

  assert.match(workspace, /handleFlowAddNode\("pinoard"[\s\S]*创建 Pinoard/);
  assert.match(flowSurface, /label: "Pinoard"[\s\S]*label: "Manus"/);
  assert.match(flowSurface, /label: "Manus"[\s\S]*label: "Lookbook"[\s\S]*label: "Cinewor"[\s\S]*label: "文件夹"/);
  assert.match(flowSurface, /label: "文本"[\s\S]*label: "图片"[\s\S]*label: "声音"[\s\S]*label: "视频"/);
  assert.match(flowSurface, /option\.type !== "scriptPage" \|\| !hasScriptPage/);
  assert.match(chrome, /"vertical" \| "horizontal" \| "filmstrip"/);
  assert.match(chrome, /onCreatePage/);
  assert.doesNotMatch(chrome, /onPreviousPage|onNextPage/);
  assert.match(writingPanel, /createBlankPage/);
  assert.match(writingPanel, /screenplay-page-edge is-previous/);
  assert.match(writingPanel, /screenplay-page-filmstrip/);
  assert.match(screenplayStyles, /scroll-snap-type: x mandatory/);
  assert.match(screenplayStyles, /\.screenplay-page-filmstrip/);
  assert.match(nodeflowStyles, /\.script-foundation-node-palette__groups \{[\s\S]*max-height: none;[\s\S]*overflow: visible;/);
});
