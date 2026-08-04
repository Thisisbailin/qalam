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
  mergeConcurrentScreenplayDrafts,
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
  createBlankScreenplayPageBody,
  ensureScreenplayTitlePage,
  ensureScreenplayPageLineGrid,
  findAutomaticPageBreakLine,
  getConnectedScriptPageSequence,
  mergeScreenplayLineWithPrevious,
  reflowConnectedScriptPages,
  reflowScreenplayPages,
  reorderConnectedScriptPages,
  splitScreenplayDocumentAtLine,
  splitScreenplayLineAtSelection,
} from "../node-workspace/screenplay/manusPages";
import {
  parseFountainTitlePage,
  serializeFountainTitlePage,
} from "../node-workspace/screenplay/titlePage";
import type { ProjectData } from "../types";

test("screenplay engine normalizes Chinese and standard scene headings into canonical Fountain", () => {
  assert.deepEqual(parseSceneHeading("【场景】内景｜旧码头｜黎明"), {
    boundary: "INT.",
    location: "旧码头",
    time: "DAWN",
  });
  assert.deepEqual(parseSceneHeading("【场景】一个嘎查咖啡馆 - 日"), {
    boundary: "INT.",
    location: "一个嘎查咖啡馆",
    time: "DAY",
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

  const reordered = reorderConnectedScriptPages(projectData, ["page-c", "page-a", "page-b"]);
  assert.deepEqual(
    getConnectedScriptPageSequence(reordered, "page-a").map((node) => node.id),
    ["page-c", "page-a", "page-b"]
  );
  assert.deepEqual(
    reordered.flow?.flowNodes?.map((node) => node.data?.pageNumber),
    [2, 3, 1]
  );
});

test("Manus keeps every manuscript page visible when an ordering edge is missing", () => {
  const nodes = ["page-a", "page-b", "page-c"].map((id, index) => ({
    id,
    type: "scriptPage" as const,
    position: { x: index * 360, y: 0 },
    data: {
      title: "潮汐线",
      text: `!第${index + 1}页`,
      documentKind: "script" as const,
      format: "fountain" as const,
      manuscriptId: "manuscript-tide",
      pageNumber: index + 1,
    },
  }));
  const projectData = {
    flow: {
      flowNodes: nodes,
      links: [
        { id: "bc", source: "page-b", target: "page-c", data: { relation: "screenplay-page" as const } },
      ],
    },
  } as ProjectData;

  assert.deepEqual(
    getConnectedScriptPageSequence(projectData, "page-c").map((node) => node.id),
    ["page-a", "page-b", "page-c"]
  );
});

test("Manus folder membership recovers legacy pages without a manuscript id", () => {
  const projectData = {
    flow: {
      flowNodes: [
        { id: "manus", type: "folder", position: { x: 0, y: 0 }, data: { folderKind: "manus" } },
        { id: "page-a", type: "scriptPage", position: { x: 100, y: 0 }, data: { pageNumber: 1 } },
        { id: "page-b", type: "scriptPage", position: { x: 460, y: 0 }, data: { pageNumber: 2 } },
      ],
      links: [
        { id: "ma", source: "manus", target: "page-a", data: { relation: "folder-membership" as const } },
        { id: "mb", source: "manus", target: "page-b", data: { relation: "folder-membership" as const } },
      ],
    },
  } as ProjectData;

  assert.deepEqual(
    getConnectedScriptPageSequence(projectData, "page-b").map((node) => node.id),
    ["page-a", "page-b"]
  );
});

test("automatic pagination chooses a real line boundary after physical capacity is exceeded", () => {
  const body = Array.from({ length: 40 }, (_, index) => `!第 ${index + 1} 行动作描述。`).join("\n");
  const breakIndex = findAutomaticPageBreakLine(body, 18);
  assert.ok(typeof breakIndex === "number" && breakIndex > 0 && breakIndex < 40);
});

test("a new screenplay sheet starts blank without forced filler lines", () => {
  const blankPage = createBlankScreenplayPageBody();
  const lines = analyzeFountainLines(blankPage);
  assert.equal(blankPage, "");
  assert.ok(lines.every((line) => line.kind === "action" && line.content === ""));
  // 页正文不再被强制填充到 54 行，末尾空行会被清理，避免删不掉的空白。
  assert.equal(ensureScreenplayPageLineGrid("!第一行"), "!第一行");
  assert.equal(ensureScreenplayPageLineGrid("!第一行\n\n\n\n"), "!第一行");
  assert.equal(findAutomaticPageBreakLine(blankPage), null);
});

test("reflow pushes overflow down but never auto-fills an under-filled page", () => {
  // 5 行动作（每行约 2.2 容量）在容量 4 下溢出到多页。
  const overflowed = reflowScreenplayPages([
    { body: ["!一", "!二", "!三", "!四", "!五"].join("\n"), pinned: false },
  ], 4);
  assert.ok(overflowed.length >= 2, "溢出内容应流到下一页");
  assert.ok(overflowed[0].body.includes("!一"));
  assert.ok(overflowed[overflowed.length - 1].body.includes("!五"));

  // 前一页未满：后一页内容**不**自动回流（保持刻意分页）。
  const kept = reflowScreenplayPages([
    { body: "!一", pinned: false },
    { body: "!二\n!三", pinned: false },
  ], 10);
  assert.equal(kept.length, 2);
  assert.equal(kept[0].body, "!一");
  assert.equal(kept[1].body, "!二\n!三");
});

test("reflow respects explicit page breaks and merges empty pages", () => {
  // === 显式分页符：后续内容形成硬边界页。
  const withBreak = reflowScreenplayPages([
    { body: "!一\n===\n!二", pinned: false },
  ], 10);
  assert.equal(withBreak.length, 2);
  assert.equal(withBreak[0].body, "!一");
  assert.equal(withBreak[1].body, "!二");
  assert.equal(withBreak[1].pinned, true);

  // 手动分页（pinned）边界在重排后保持。
  const pinned = reflowScreenplayPages([
    { body: "!一", pinned: false },
    { body: "!二\n!三", pinned: true },
  ], 10);
  assert.equal(pinned.length, 2);
  assert.equal(pinned[1].pinned, true);
  assert.equal(pinned[1].body, "!二\n!三");

  // 空页被合并，不产生多余页。
  const merged = reflowScreenplayPages([
    { body: "!一", pinned: false },
    { body: "", pinned: false },
    { body: "!二", pinned: false },
  ], 10);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].body, "!一");
  assert.equal(merged[1].body, "!二");
});

test("reflowConnectedScriptPages rewrites the sequence and supports gesture merge", () => {
  const makePage = (id: string, body: string, x: number) => ({
    id,
    type: "scriptPage" as const,
    position: { x, y: 0 },
    data: {
      text: body,
      content: body,
      documentKind: "script" as const,
      format: "fountain" as const,
      manuscriptId: "manuscript-flow",
    },
  });
  const base: ProjectData = {
    fileName: "流动分页",
    rawScript: "",
    episodes: [],
    roles: [],
    designAssets: [],
    canvas: { viewport: null },
    flow: {
      flowNodes: [makePage("page-a", "!一", 0), makePage("page-b", "!二\n!三", 380)],
      links: [{
        id: "page-a-b",
        source: "page-a",
        target: "page-b",
        data: { relation: "screenplay-page" as const },
      }],
    },
    flowProjects: [],
    activeFlowProjectId: "p",
    stats: { context: { total: 0, success: 0, error: 0 } },
  } as unknown as ProjectData;

  // 页 b 开头删除（正文从 "!二\n!三" 变为 "!三"）且上一页有回流空间：
  // 手势合并后 "!三" 回流到 page-a，page-b 变空并被移除。
  const merged = reflowConnectedScriptPages(base, "page-b", {
    bodyOverrides: { "page-b": "!三" },
    cursorLine: 0,
    mergeNextPageId: "page-b",
  });
  assert.ok(merged);
  assert.equal(merged.changed, true);
  assert.equal(merged.contentNodeIds.length, 1);
  const after = getConnectedScriptPageSequence(merged.projectData, "page-a");
  assert.equal(after.length, 1);
  assert.equal(String(after[0].data?.content || "").trim(), "!一\n!三");

  // 无手势（普通重排）：不满页不回填，溢出才下推。
  const overflowBase = reflowConnectedScriptPages({
    ...base,
    flow: {
      flowNodes: [makePage("page-a", ["!一", "!二", "!三"].join("\n"), 0), makePage("page-b", "!二\n!三", 380)],
      links: [{ id: "page-a-b", source: "page-a", target: "page-b", data: { relation: "screenplay-page" as const } }],
    },
  } as unknown as ProjectData, "page-a", { cursorLine: 2 });
  assert.ok(overflowBase);
  const overflowSequence = getConnectedScriptPageSequence(overflowBase.projectData, "page-a");
  assert.ok(overflowSequence.length >= 2);
});

test("screenplay title pages serialize only user-entered Fountain metadata", () => {
  assert.equal(serializeFountainTitlePage({ title: "", author: "", date: "", revision: "" }), "");
  const source = serializeFountainTitlePage({
    title: "潮汐线",
    author: "林默",
    date: "2026-08-04",
    revision: "第二稿",
  });
  assert.equal(source, "Title: 潮汐线\nAuthor: 林默\nDraft date: 2026-08-04\nRevision: 第二稿");
  assert.deepEqual(parseFountainTitlePage(source), {
    title: "潮汐线",
    author: "林默",
    date: "2026-08-04",
    revision: "第二稿",
  });
});

test("Manus migrates its cover into a fixed first scriptPage node", () => {
  const page = {
    id: "page-a",
    type: "scriptPage" as const,
    position: { x: 400, y: 100 },
    data: {
      title: "潮汐线",
      content: "!第一场",
      manuscriptId: "manuscript-a",
      pageNumber: 1,
    },
  };
  const projectData = {
    flow: {
      flowNodes: [page, {
        id: "manus-a",
        type: "folder" as const,
        position: { x: 0, y: 100 },
        data: { folderKind: "manus", manuscriptId: "manuscript-a" },
      }],
      links: [{
        id: "membership",
        source: "manus-a",
        target: "page-a",
        data: { relation: "folder-membership" as const },
      }],
    },
  } as ProjectData;
  const migrated = ensureScreenplayTitlePage(projectData, page.id);
  const sequence = getConnectedScriptPageSequence(migrated.projectData, page.id);
  assert.equal(migrated.created, true);
  assert.equal(sequence[0].type, "scriptPage");
  assert.equal(sequence[0].data?.pageRole, "title");
  assert.equal(sequence[0].data?.content, "");
  assert.equal(sequence[1].id, page.id);
  assert.ok(migrated.projectData.flow?.links?.some((link) => (
    link.source === "manus-a" && link.target === sequence[0].id
  )));

  const attemptedReorder = reorderConnectedScriptPages(
    migrated.projectData,
    [page.id, sequence[0].id]
  );
  assert.equal(getConnectedScriptPageSequence(attemptedReorder, page.id)[0].id, sequence[0].id);
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
  assert.deepEqual(parseSceneHeading("INT.一个嘎查咖啡馆 - 日"), {
    boundary: "INT.",
    location: "一个嘎查咖啡馆",
    time: "DAY",
  });
  assert.equal(
    serializeSceneHeading(parseSceneHeading("INT.一个嘎查咖啡馆 - 日")),
    ".INT. 一个嘎查咖啡馆 - DAY"
  );
});

test("format conversion preserves visible content and permits an empty role cue", () => {
  const line = analyzeFountainLines("!门自内打开。")[0];
  assert.equal(convertScreenplayLineKind(line, "dialogue"), "门自内打开。");
  assert.equal(serializeScreenplayLine("", "character"), "@");
  assert.equal(analyzeFountainLines("@")[0].kind, "character");
  assert.equal(analyzeFountainLines(serializeScreenplayLine("", "dialogue"))[0].kind, "dialogue");
});

test("format cycling does not promote format scaffolding into screenplay content", () => {
  const scene = analyzeFountainLines(".INT. LOCATION - DAY")[0];
  assert.equal(convertScreenplayLineKind(scene, "character"), "@");
  assert.equal(convertScreenplayLineKind(scene, "dialogue"), "【对白】");
  assert.equal(convertScreenplayLineKind(scene, "action"), "");

  const parenthetical = analyzeFountainLines("(beat)")[0];
  assert.equal(convertScreenplayLineKind(parenthetical, "action"), "");

  const transition = analyzeFountainLines("> CUT TO:")[0];
  assert.equal(convertScreenplayLineKind(transition, "action"), "");
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

test("screenplay drafts auto-merge disjoint text edits and flag overlapping replacements", () => {
  const base = { title: "第一场", body: "第一行\n第二行" };
  const disjoint = mergeConcurrentScreenplayDrafts(
    base,
    { ...base, body: "第一行（本地）\n第二行" },
    { ...base, body: "第一行\n第二行（远端）" },
  );
  assert.deepEqual(disjoint.conflicts, []);
  assert.match(disjoint.merged.body, /本地/);
  assert.match(disjoint.merged.body, /远端/);

  const overlapping = mergeConcurrentScreenplayDrafts(
    base,
    { ...base, body: "本地替换\n第二行" },
    { ...base, body: "远端替换\n第二行" },
  );
  assert.deepEqual(overlapping.conflicts, ["body"]);

  const titleConflict = mergeConcurrentScreenplayDrafts(
    base,
    { ...base, title: "第一场·本地" },
    { ...base, title: "第一场·远端" },
  );
  assert.deepEqual(titleConflict.conflicts, ["title"]);
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
