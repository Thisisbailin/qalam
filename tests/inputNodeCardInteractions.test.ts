import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("input cards expose desktop and touch context actions without regressing media and Manus visuals", async () => {
  const [flowSurface, workspace, folderNode, stylesheet] = await Promise.all([
    readFile(path.resolve("node-workspace/components/FlowSurface.tsx"), "utf8"),
    readFile(path.resolve("node-workspace/components/CreativeWorkspace.tsx"), "utf8"),
    readFile(path.resolve("node-workspace/nodes/FolderNode.tsx"), "utf8"),
    readFile(path.resolve("node-workspace/styles/nodeflow.css"), "utf8"),
  ]);

  assert.match(flowSurface, /handleInputNodeContextMenu/);
  assert.match(flowSurface, /handleCopyInputNode/);
  assert.match(flowSurface, /handlePasteInputNode/);
  assert.match(flowSurface, /handleDeleteInputNode/);
  assert.match(flowSurface, /collectUnreferencedOwnedStorageObjects/);
  assert.match(workspace, /event\.pointerType === "mouse"/);
  assert.match(workspace, /setTimeout\(\(\) => \{/);
  assert.match(workspace, /}, 520\)/);

  assert.doesNotMatch(folderNode, /manus-wrapper-node__title/);
  assert.doesNotMatch(folderNode, /manus-wrapper-node__footer/);
  assert.match(folderNode, /manus-wrapper-node__sheet--front[\s\S]*<Paperclip/);
  assert.match(stylesheet, /\.image-input-media\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?border-radius:\s*24px;/);

  const finalMobilePass = stylesheet.slice(stylesheet.lastIndexOf("/* Mobile dock: final cascade layer"));
  assert.match(finalMobilePass, /bottom:\s*calc\(8px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  assert.match(finalMobilePass, /\.script-foundation-dock\.script-foundation-filmstrip \.script-foundation-bar-label[\s\S]*?width:\s*44px !important;/);
  assert.match(finalMobilePass, /grid-template-columns:\s*repeat\(3, 44px\)/);
  assert.match(finalMobilePass, /\.input-node-context-menu__swatch\s*\{[\s\S]*?width:\s*44px;/);
});
