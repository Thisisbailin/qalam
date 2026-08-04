import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";

const readWorkspaceFile = (relativePath: string) =>
  readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

const stylesheet = readWorkspaceFile("node-workspace/styles/nodeflow.css");
const flowSurface = readWorkspaceFile("node-workspace/components/FlowSurface.tsx");
const creativeWorkspace = readWorkspaceFile("node-workspace/components/CreativeWorkspace.tsx");
const floatingActionBar = readWorkspaceFile("node-workspace/components/FloatingActionBar.tsx");
const viewportControls = readWorkspaceFile("node-workspace/components/ViewportControls.tsx");

const finalLayoutMarker = "/* Bottom dock visual system v2: one continuous surface";
const finalLayoutStart = stylesheet.lastIndexOf(finalLayoutMarker);
assert.notEqual(finalLayoutStart, -1, "Missing final unified bottom dock layout");
const finalLayout = stylesheet.slice(finalLayoutStart);

const readRule = (selector: string, source = finalLayout) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `Missing CSS rule: ${selector}`);
  return match[1];
};

test("bottom dock is one anchored surface with an internal expanding tray", () => {
  const dockRule = readRule(
    '.script-foundation-dock.script-foundation-filmstrip[data-foundation-expanded="true"]'
  );
  const trayRule = readRule(
    ".script-foundation-dock.script-foundation-filmstrip .script-foundation-dock__tray"
  );
  const expandedTrayRule = readRule(
    '.script-foundation-dock.script-foundation-filmstrip[data-dock-expanded="true"] .script-foundation-dock__tray'
  );
  const barRule = readRule(
    ".script-foundation-dock.script-foundation-filmstrip .script-foundation-dock__bar"
  );

  assert.match(dockRule, /width:\s*min\(var\(--dock-width\),\s*calc\(100vw\s*-\s*32px\)\)/);
  assert.match(dockRule, /overflow:\s*hidden/);
  assert.match(dockRule, /transition:[\s\S]*width\s+300ms/);

  assert.match(trayRule, /max-height:\s*0/);
  assert.match(trayRule, /border:\s*0\s*!important/);
  assert.match(trayRule, /opacity:\s*0/);
  assert.doesNotMatch(trayRule, /translate(?:3d)?\s*\(/);
  assert.doesNotMatch(trayRule, /position:\s*(?:fixed|absolute)/);

  assert.match(expandedTrayRule, /max-height:\s*min\(54dvh,\s*500px\)/);
  assert.match(expandedTrayRule, /opacity:\s*1/);
  assert.match(barRule, /border:\s*0\s*!important/);
  assert.match(barRule, /background:\s*transparent\s*!important/);
});

test("mounted upper component controls the width of the whole dock", () => {
  const expectedWidths = new Map([
    [".script-foundation-axis-body", "1080px"],
    [".script-foundation-gateway", "960px"],
    [".script-foundation-node-palette", "960px"],
    [".script-foundation-tail-composer", "680px"],
    [".script-foundation-account-panel", "460px"],
    [".script-foundation-viewport-tray-panel", "286px"],
  ]);

  for (const [mountedComponent, width] of expectedWidths) {
    const selector = `.script-foundation-dock.script-foundation-filmstrip:has(${mountedComponent})`;
    assert.match(readRule(selector), new RegExp(`--dock-width:\\s*${width}`));
  }
});

test("all expanded tools render into the same dock tray host", () => {
  assert.match(
    flowSurface,
    /id="script-foundation-dock-tray-host"[\s\S]*className="script-foundation-dock__tray"/
  );
  assert.match(
    creativeWorkspace,
    /globalDockTrayHostId="script-foundation-dock-tray-host"/
  );
  assert.match(
    creativeWorkspace,
    /document\.getElementById\("script-foundation-dock-tray-host"\)/
  );
  assert.match(floatingActionBar, /createPortal\([\s\S]*globalDockTrayHost\s*\|\|\s*document\.body/);
  assert.match(viewportControls, /trayHost\s*\?\s*createPortal\(/);
});

test("account host discovery remains stable when the canvas mounts asynchronously", () => {
  assert.match(floatingActionBar, /new MutationObserver\(syncHosts\)/);
  assert.match(
    floatingActionBar,
    /observer\.observe\(document\.body,\s*\{\s*childList:\s*true,\s*subtree:\s*true\s*\}\)/
  );
  assert.match(creativeWorkspace, /new MutationObserver\(syncHost\)/);
});

test("Foundation stays icon-only and Agent label becomes the lower send control", () => {
  const foundationButtonStart = flowSurface.indexOf(
    "script-foundation-bar-label script-foundation-bar-label--foundation"
  );
  const foundationButtonEnd = flowSurface.indexOf("</button>", foundationButtonStart);
  const foundationButton = flowSurface.slice(foundationButtonStart, foundationButtonEnd);

  assert.notEqual(foundationButtonStart, -1);
  assert.doesNotMatch(foundationButton, /script-foundation-bar-label__text/);
  assert.doesNotMatch(foundationButton, />\s*Foundation\s*</);
  assert.match(foundationButton, /<Clock3[\s\S]*<MapIcon/);

  assert.match(flowSurface, /isAgentTailOpen\s*\?\s*\([\s\S]*<ArrowUp/);
  assert.match(flowSurface, /isAgentSending\s*\?\s*<Square/);
  assert.match(flowSurface, /if\s*\(isAgentTailOpen\)\s*\{\s*handleAgentTailSend\(\)/);
  assert.match(flowSurface, /className="script-foundation-tail-composer stylo-surface"[\s\S]*<textarea/);
});

test("Add Nodes uses a compact panel grid instead of a vertical list", () => {
  const groupRule = readRule(
    ".script-foundation-dock.script-foundation-filmstrip .script-foundation-node-palette__groups"
  );
  const nodeGridRule = readRule(
    ".script-foundation-dock.script-foundation-filmstrip .script-foundation-node-grid"
  );

  assert.match(groupRule, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(groupRule, /overflow-x:\s*auto/);
  assert.match(nodeGridRule, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});
