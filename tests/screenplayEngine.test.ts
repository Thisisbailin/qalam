import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeFountainLines,
  analyzeScreenplay,
  convertScreenplayLineKind,
  getNextScreenplayLineKind,
  insertScreenplayLine,
  normalizeFountainDocument,
  parseSceneHeading,
  removeScreenplayLine,
  replaceScreenplayLine,
  serializeSceneHeading,
  serializeScreenplayLine,
} from "../node-workspace/screenplay/fountainEngine";
import {
  classifyIncomingScreenplaySource,
  prepareScreenplayDraftForSave,
} from "../node-workspace/screenplay/saveCoordinator";
import {
  buildScriptLinePatch,
  deriveReviewedScriptBody,
  hasPendingPatchLines,
  type PendingScriptPatch,
} from "../node-workspace/screenplay/scriptPatch";
import { toNodeFlowNodeRecord } from "../node-workspace/nodeflow/model";
import {
  findAutomaticPageBreakLine,
  getConnectedScriptPageSequence,
  mergeScreenplayLineWithPrevious,
  splitScreenplayDocumentAtLine,
  splitScreenplayLineAtSelection,
} from "../node-workspace/screenplay/manusPages";
import type { ProjectData } from "../types";

test("screenplay engine normalizes Chinese and standard scene headings into canonical Fountain", () => {
  assert.deepEqual(parseSceneHeading("【场景】内景｜旧码头｜黎明"), {
    boundary: "INT.",
    location: "旧码头",
    time: "DAWN",
  });
  assert.equal(
    serializeSceneHeading({ boundary: "EXT.", location: "RIVER BANK", time: "NIGHT" }),
    ".EXT. RIVER BANK - NIGHT"
  );
  assert.equal(
    normalizeFountainDocument("【场景】外景｜旧码头｜夜\n【角色】林默\n【对白】别回头。"),
    ".EXT. 旧码头 - NIGHT\n@林默\n别回头。"
  );
});

test("visual screenplay block operations preserve canonical line structure", () => {
  let body = serializeSceneHeading({ boundary: "INT.", location: "EDIT ROOM", time: "NIGHT" });
  body = insertScreenplayLine(body, 0, serializeScreenplayLine("林默", "character"));
  body = insertScreenplayLine(body, 1, serializeScreenplayLine("停在最后一帧。", "dialogue"));
  body = replaceScreenplayLine(body, 2, serializeScreenplayLine("画面冻结。", "action"));

  assert.deepEqual(
    analyzeFountainLines(body).map(({ kind, content }) => ({ kind, content })),
    [
      { kind: "scene_heading", content: "INT. EDIT ROOM - NIGHT" },
      { kind: "character", content: "林默" },
      { kind: "action", content: "画面冻结。" },
    ]
  );
  assert.equal(removeScreenplayLine(body, 1), ".INT. EDIT ROOM - NIGHT\n!画面冻结。");
  assert.equal(getNextScreenplayLineKind("character"), "dialogue");
  assert.equal(getNextScreenplayLineKind("dialogue"), "action");
});

test("enter splits screenplay content at the actual cursor position", () => {
  const body = "!风吹过空旷的站台。";
  const line = analyzeFountainLines(body)[0];
  assert.equal(splitScreenplayLineAtSelection(body, line, 0), "\n!风吹过空旷的站台。");
  assert.equal(splitScreenplayLineAtSelection(body, line, 4), "!风吹过空\n!旷的站台。");
  assert.equal(splitScreenplayLineAtSelection(body, line, line.content.length), "!风吹过空旷的站台。\n");
});

test("backspace at a populated line start merges content into the previous screenplay line", () => {
  const body = "!前一行\n!后一行";
  const line = analyzeFountainLines(body)[1];
  assert.deepEqual(mergeScreenplayLineWithPrevious(body, line), {
    body: "!前一行后一行",
    cursor: 3,
  });

  const emptyLine = analyzeFountainLines("!前一行\n")[1];
  assert.deepEqual(mergeScreenplayLineWithPrevious("!前一行\n", emptyLine), {
    body: "!前一行",
    cursor: 3,
  });
});

test("Manus resolves a connected page sequence from any page and splits at line boundaries", () => {
  const nodes = ["page-a", "page-b", "page-c"].map((id, index) => ({
    id,
    type: "scriptPage" as const,
    position: { x: index * 360, y: 0 },
    data: { title: "潮汐线", text: `!第${index + 1}页`, documentKind: "script" as const, format: "fountain" as const },
  }));
  const projectData = {
    flow: {
      flowNodes: nodes,
      links: [
        { id: "ab", source: "page-a", target: "page-b", data: { relation: "screenplay-page" as const } },
        { id: "bc", source: "page-b", target: "page-c", data: { relation: "screenplay-page" as const } },
      ],
    },
  } as ProjectData;
  assert.deepEqual(getConnectedScriptPageSequence(projectData, "page-c").map((node) => node.id), ["page-a", "page-b", "page-c"]);
  assert.deepEqual(splitScreenplayDocumentAtLine("!第一行\n!第二行\n!第三行", 1), {
    currentBody: "!第一行",
    nextBody: "!第二行\n!第三行",
  });
});

test("automatic pagination chooses a real line boundary after physical capacity is exceeded", () => {
  const body = Array.from({ length: 40 }, (_, index) => `!第 ${index + 1} 行动作描述。`).join("\n");
  const breakIndex = findAutomaticPageBreakLine(body, 18);
  assert.ok(typeof breakIndex === "number" && breakIndex > 0 && breakIndex < 40);
});

test("screenplay analysis builds navigation, production metrics, and continuity diagnostics", () => {
  const analysis = analyzeScreenplay(
    [
      ".EXT. OLD PIER - DAWN",
      "海雾漫过断裂的栈桥。",
      "@林默",
      "别回头。",
      "",
      ".INT. CONTROL ROOM - NIGHT",
      "@陌生人",
      "时间到了。",
    ].join("\n"),
    ["林默"]
  );

  assert.equal(analysis.scenes.length, 2);
  assert.equal(analysis.scenes[0].location, "OLD PIER");
  assert.deepEqual(analysis.scenes[0].characterNames, ["林默"]);
  assert.deepEqual(analysis.locations, ["OLD PIER", "CONTROL ROOM"]);
  assert.equal(analysis.stats.characters, 2);
  assert.ok(analysis.stats.dialoguePercent > 0);
  assert.ok(analysis.diagnostics.some((issue) => issue.message.includes("陌生人")));
});

test("Chinese action prose is never guessed as a character while known aliases are resolved", () => {
  const body = [
    "暴雨如注。荒山深处，一座孤零零的古宅亮着微弱的烛火。",
    "下一句动作。",
    "",
    "阿弋",
    "",
    "他不会再来了。",
  ].join("\n");
  const known = [{ id: "role-shenyi", name: "沈弋", mention: "沈弋", aliases: ["阿弋"] }];
  const lines = analyzeFountainLines(body, known);
  assert.equal(lines[0].kind, "action");
  assert.equal(lines[3].kind, "character");
  assert.equal(lines[5].kind, "dialogue");

  const analysis = analyzeScreenplay(body, known);
  assert.deepEqual(analysis.characterNames, ["沈弋"]);
  assert.equal(analysis.characterReferences[0].roleId, "role-shenyi");
  assert.equal(analysis.characterReferences[0].bound, true);
});

test("dialogue context survives visual spacer lines but does not leak into the next action", () => {
  const lines = analyzeFountainLines([
    "@沈弋",
    "",
    "（声音沙哑）",
    "",
    "他不会再来了。",
    "",
    "雨声吞没一切。",
  ].join("\n"));
  assert.deepEqual(lines.map((line) => line.kind), [
    "character",
    "action",
    "parenthetical",
    "action",
    "dialogue",
    "action",
    "action",
  ]);
});

test("scene parsing removes duplicate localized time suffixes", () => {
  assert.deepEqual(parseSceneHeading(".INT. 古宅门前 - 夜 - DAY"), {
    boundary: "INT.",
    location: "古宅门前",
    time: "DAY",
  });
});

test("format conversion preserves visible content and permits an empty role cue", () => {
  const line = analyzeFountainLines("!门自内打开。")[0];
  assert.equal(convertScreenplayLineKind(line, "dialogue"), "门自内打开。");
  assert.equal(serializeScreenplayLine("", "character"), "@");
  assert.equal(analyzeFountainLines("@")[0].kind, "character");
  assert.equal(analyzeFountainLines(serializeScreenplayLine("", "dialogue"))[0].kind, "dialogue");
});

test("autosave coordinator ignores stale echoes and adopts real external changes", () => {
  const source = { title: "第一场", body: "!旧稿" };
  const submitted = { title: "第一场", body: "!新稿" };
  const localAfterSubmit = { title: "第一场", body: "!更新的本地稿" };
  assert.equal(classifyIncomingScreenplaySource({
    source,
    draft: localAfterSubmit,
    lastCommitted: submitted,
    lastObservedSource: source,
    pendingSave: { submitted, previousSource: source },
  }), "unchanged");
  assert.equal(classifyIncomingScreenplaySource({
    source: submitted,
    draft: localAfterSubmit,
    lastCommitted: submitted,
    lastObservedSource: source,
    pendingSave: { submitted, previousSource: source },
  }), "acknowledge");
  assert.equal(classifyIncomingScreenplaySource({
    source: { title: "外部", body: "!协作者版本" },
    draft: localAfterSubmit,
    lastCommitted: submitted,
    lastObservedSource: source,
    pendingSave: { submitted, previousSource: source },
  }), "conflict");
  assert.deepEqual(prepareScreenplayDraftForSave({ title: "  ", body: "!A\r\n!B" }), {
    title: "剧本文档",
    body: "!A\n!B",
  });
});

test("agent screenplay patches remain reviewable and deterministic", () => {
  const base = ".INT. ROOM - DAY\n@林默\n别动。";
  const next = ".INT. ROOM - NIGHT\n@林默\n别回头。";
  const lines = buildScriptLinePatch(base, next);
  const patch: PendingScriptPatch = {
    id: "proposal-1",
    baseTitle: "第一场",
    nextTitle: "第一场修订",
    baseBody: base,
    nextBody: next,
    lines,
  };

  assert.equal(hasPendingPatchLines(patch), true);
  const accepted = {
    ...patch,
    lines: patch.lines.map((line) => line.kind === "equal" ? line : { ...line, status: "accepted" as const }),
  };
  assert.equal(hasPendingPatchLines(accepted), false);
  assert.equal(deriveReviewedScriptBody(accepted), next);
});

test("screenplay revision metadata reaches the bounded NodeFlow projection", () => {
  const record = toNodeFlowNodeRecord({
    id: "script-main",
    type: "scriptPage",
    position: { x: 0, y: 0 },
    data: {
      title: "潮汐线",
      content: ".EXT. OLD PIER - DAWN",
      revision: 7,
      screenplayStats: {
        lines: 83,
        scenes: 6,
        characters: 4,
        locations: 3,
        words: 412,
        glyphs: 1267,
        estimatedPages: 3,
        estimatedMinutes: 3,
        dialoguePercent: 42,
        ignored: "must not cross the projection boundary",
      },
    },
  });

  assert.equal(record.body.revision, 7);
  assert.deepEqual(record.body.screenplayStats, {
    lines: 83,
    scenes: 6,
    characters: 4,
    locations: 3,
    words: 412,
    glyphs: 1267,
    estimatedPages: 3,
    estimatedMinutes: 3,
    dialoguePercent: 42,
  });
});
