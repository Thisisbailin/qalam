import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowBendDownRight,
  BracketsRound,
  ChatCenteredText,
  Check,
  EyeSlash,
  FilePlus,
  FilmSlate,
  ListBullets,
  MagnifyingGlass,
  MusicNotes,
  NoteBlank,
  Quotes,
  TextAlignCenter,
  TextT,
  User,
  X,
} from "@phosphor-icons/react";
import {
  convertScreenplayLineKind,
  getNextScreenplayLineKind,
  insertScreenplayLine,
  parseSceneHeading,
  replaceScreenplayLine,
  SCENE_BOUNDARIES,
  SCENE_TIMES,
  SCREENPLAY_FORMAT_LABELS,
  SCREENPLAY_FORMAT_SHORTCUTS,
  SCREENPLAY_LINE_KINDS,
  serializeSceneHeading,
  serializeScreenplayLine,
  type ScreenplayLine,
  type ScreenplayLineKind,
} from "../../screenplay/fountainEngine";
import {
  mergeScreenplayLineWithPrevious,
  splitScreenplayLineAtSelection,
} from "../../screenplay/manusPages";

export type ScreenplayCharacterSuggestion = {
  id: string;
  name: string;
  mention: string;
  status?: string;
};

type SelectionPayload = {
  text: string;
  start: number;
  end: number;
  lineIndex: number;
  anchorX: number;
  anchorY: number;
};

type Props = {
  body: string;
  lines: ScreenplayLine[];
  activeLineIndex: number;
  navigationRequest: { lineIndex: number; id: number } | null;
  readOnly?: boolean;
  characterSuggestions: ScreenplayCharacterSuggestion[];
  locationSuggestions: string[];
  onChange: (body: string) => void;
  onActiveLineChange: (lineIndex: number) => void;
  onSelectionChange?: (selection: SelectionPayload | null) => void;
  onCreatePageFromLine?: (lineIndex: number) => void;
  locationOptionsId?: string;
};

const KIND_ICONS: Record<ScreenplayLineKind, React.ComponentType<{ size?: number; weight?: "regular" | "bold" }>> = {
  action: TextT,
  scene_heading: FilmSlate,
  character: User,
  dual_dialogue: Quotes,
  dialogue: ChatCenteredText,
  parenthetical: BracketsRound,
  lyric: MusicNotes,
  transition: ArrowBendDownRight,
  centered: TextAlignCenter,
  note: NoteBlank,
  boneyard: EyeSlash,
  section: ListBullets,
  synopsis: ListBullets,
  page_break: ListBullets,
};

const PRIMARY_KINDS: ScreenplayLineKind[] = [
  "action",
  "scene_heading",
  "character",
  "dialogue",
  "parenthetical",
  "transition",
];

const SECONDARY_KINDS = SCREENPLAY_LINE_KINDS.filter(
  (kind) => kind !== "page_break" && !PRIMARY_KINDS.includes(kind)
);

const getContentOffset = (line: ScreenplayLine) => {
  if (!line.content) return 0;
  const offset = line.raw.indexOf(line.content);
  return offset >= 0 ? offset : 0;
};

type RowProps = {
  line: ScreenplayLine;
  isActive: boolean;
  readOnly: boolean;
  registerEditor: (lineIndex: number, element: HTMLTextAreaElement | HTMLInputElement | null) => void;
  requestFocus: (lineIndex: number, position?: "start" | "end" | number, waitForMount?: boolean) => void;
  onReplaceLine: (lineIndex: number, raw: string) => void;
  onInsertAfter: (lineIndex: number, raw: string) => void;
  onSplitLine: (line: ScreenplayLine, selectionStart: number, selectionEnd: number) => void;
  onMergeWithPrevious: (line: ScreenplayLine) => number;
  onCreatePageFromLine?: (lineIndex: number) => void;
  onActive: (lineIndex: number) => void;
  onSelectionChange?: (selection: SelectionPayload | null) => void;
  characterSuggestions: ScreenplayCharacterSuggestion[];
  mentionOpen: boolean;
  onOpenMention: (lineIndex: number) => void;
  onCloseMention: () => void;
  locationOptionsId: string;
};

const ScreenplayBlockRow = memo(({
  line,
  isActive,
  readOnly,
  registerEditor,
  requestFocus,
  onReplaceLine,
  onInsertAfter,
  onSplitLine,
  onMergeWithPrevious,
  onCreatePageFromLine,
  onActive,
  onSelectionChange,
  characterSuggestions,
  mentionOpen,
  onOpenMention,
  onCloseMention,
  locationOptionsId,
}: RowProps) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const KindIcon = KIND_ICONS[line.kind];
  const scene = line.kind === "scene_heading" ? parseSceneHeading(line.raw) : null;
  const filteredCharacters = useMemo(() => {
    const query = mentionQuery.trim().toLocaleLowerCase();
    if (!query) return characterSuggestions;
    return characterSuggestions.filter((item) =>
      `${item.name} ${item.mention}`.toLocaleLowerCase().includes(query)
    );
  }, [characterSuggestions, mentionQuery]);

  useEffect(() => {
    if (!mentionOpen) setMentionQuery("");
  }, [mentionOpen]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = line.content
      ? `${Math.max(20, textarea.scrollHeight)}px`
      : `${isActive ? 20 : 16}px`;
  }, [isActive, line.content]);

  const assignEditor = (element: HTMLTextAreaElement | null) => {
    textareaRef.current = element;
    registerEditor(line.index, element);
  };

  const changeKind = (kind: ScreenplayLineKind) => {
    onReplaceLine(line.index, convertScreenplayLineKind(line, kind));
    setFormatMenuOpen(false);
    requestFocus(line.index, "end");
  };

  const insertNextLine = () => {
    const nextKind = getNextScreenplayLineKind(line.kind);
    const nextRaw = serializeScreenplayLine("", nextKind);
    onInsertAfter(line.index, nextRaw);
    requestFocus(line.index + 1, "start", true);
  };

  const cyclePrimaryKind = (reverse = false) => {
    const currentIndex = PRIMARY_KINDS.indexOf(line.kind);
    const startIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (startIndex + (reverse ? -1 : 1) + PRIMARY_KINDS.length) % PRIMARY_KINDS.length;
    changeKind(PRIMARY_KINDS[nextIndex]);
  };

  const handleFormatCycle = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey || mentionOpen) return false;
    event.preventDefault();
    cyclePrimaryKind(event.shiftKey);
    return true;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (handleFormatCycle(event)) return;
    if (event.key === "@" && (["character", "dual_dialogue"].includes(line.kind) || !line.content.trim())) {
      event.preventDefault();
      if (!["character", "dual_dialogue"].includes(line.kind)) {
        onReplaceLine(line.index, serializeScreenplayLine("", "character"));
      }
      onOpenMention(line.index);
      return;
    }
    if (event.key === "Escape" && mentionOpen) {
      event.preventDefault();
      onCloseMention();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const selectionStart = event.currentTarget.selectionStart || 0;
      const selectionEnd = event.currentTarget.selectionEnd || selectionStart;
      onSplitLine(line, selectionStart, selectionEnd);
      requestFocus(line.index + 1, "start", true);
      return;
    }
    if (
      event.key === "Backspace" &&
      event.currentTarget.selectionStart === 0 &&
      event.currentTarget.selectionEnd === 0 &&
      line.index > 0
    ) {
      event.preventDefault();
      const cursor = onMergeWithPrevious(line);
      requestFocus(line.index - 1, cursor, true);
      return;
    }
    if (event.key === "ArrowUp" && event.currentTarget.selectionStart === 0 && line.index > 0) {
      event.preventDefault();
      requestFocus(line.index - 1, "end");
    }
    if (event.key === "ArrowDown" && event.currentTarget.selectionStart === line.content.length) {
      event.preventDefault();
      requestFocus(line.index + 1, "start");
    }
  };

  const publishSelection = (target: HTMLTextAreaElement) => {
    const start = target.selectionStart || 0;
    const end = target.selectionEnd || start;
    if (end <= start) {
      onSelectionChange?.(null);
      return;
    }
    const contentOffset = getContentOffset(line);
    const rect = target.getBoundingClientRect();
    onSelectionChange?.({
      text: target.value.slice(start, end),
      start: line.start + contentOffset + start,
      end: line.start + contentOffset + end,
      lineIndex: line.index,
      anchorX: Math.max(76, Math.min(window.innerWidth - 76, rect.left + rect.width / 2)),
      anchorY: Math.max(68, rect.top - 8),
    });
  };

  return (
    <div
      id={`screenplay-line-${line.index}`}
      className={`screenplay-block screenplay-block--${line.kind} ${isActive ? "is-active" : ""} ${line.content ? "" : "is-empty"}`}
      data-line={line.index + 1}
      onMouseDown={() => onActive(line.index)}
    >
      <div className="screenplay-block__gutter">
        <button
          type="button"
          className="screenplay-block__kind-button"
          onClick={() => setFormatMenuOpen((open) => !open)}
          aria-label={`当前格式：${SCREENPLAY_FORMAT_LABELS[line.kind]}`}
          aria-expanded={formatMenuOpen}
          disabled={readOnly}
        >
          <KindIcon size={15} weight={isActive ? "bold" : "regular"} />
        </button>
        {formatMenuOpen ? (
          <div className="screenplay-block__format-menu" role="menu">
            <div className="screenplay-block__format-group">
              {PRIMARY_KINDS.map((kind) => {
                const Icon = KIND_ICONS[kind];
                return (
                  <button key={kind} type="button" onClick={() => changeKind(kind)} className={line.kind === kind ? "is-active" : ""}>
                    <Icon size={14} />
                    <span>{SCREENPLAY_FORMAT_LABELS[kind]}</span>
                    <kbd>{SCREENPLAY_FORMAT_SHORTCUTS[kind]}</kbd>
                  </button>
                );
              })}
            </div>
            <div className="screenplay-block__format-group is-secondary">
              {SECONDARY_KINDS.map((kind) => (
                <button key={kind} type="button" onClick={() => changeKind(kind)} className={line.kind === kind ? "is-active" : ""}>
                  <span>{SCREENPLAY_FORMAT_LABELS[kind]}</span>
                </button>
              ))}
            </div>
            {onCreatePageFromLine ? (
              <div className="screenplay-block__format-group is-page-action">
                <button type="button" onClick={() => { setFormatMenuOpen(false); onCreatePageFromLine(line.index); }}>
                  <FilePlus size={14} />
                  <span>从此行新建稿纸</span>
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="screenplay-block__content">
        {scene ? (
          <div className="screenplay-scene-heading" aria-label="场景标题">
            <label>
              <span>内外景</span>
              <select
                value={scene.boundary}
                onFocus={() => onActive(line.index)}
                onChange={(event) => onReplaceLine(line.index, serializeSceneHeading({ ...scene, boundary: event.target.value }))}
                onKeyDown={handleFormatCycle}
                disabled={readOnly}
              >
                {SCENE_BOUNDARIES.map((boundary) => <option key={boundary} value={boundary}>{boundary}</option>)}
              </select>
            </label>
            <label className="is-location">
              <span>地点</span>
              <input
                ref={(element) => registerEditor(line.index, element)}
                value={scene.location}
                style={{ width: `${Math.max(6, Array.from(scene.location || "地点").length + 2)}ch` }}
                list={locationOptionsId}
                onFocus={() => onActive(line.index)}
                onChange={(event) => onReplaceLine(line.index, serializeSceneHeading({ ...scene, location: event.target.value }))}
                onKeyDown={(event) => {
                  if (handleFormatCycle(event)) return;
                  if (event.key === "Enter") {
                    event.preventDefault();
                    insertNextLine();
                  }
                }}
                disabled={readOnly}
                aria-label="场景地点"
              />
            </label>
            <label>
              <span>时间</span>
              <select
                value={scene.time}
                onFocus={() => onActive(line.index)}
                onChange={(event) => onReplaceLine(line.index, serializeSceneHeading({ ...scene, time: event.target.value }))}
                onKeyDown={handleFormatCycle}
                disabled={readOnly}
              >
                {SCENE_TIMES.map((time) => <option key={time} value={time}>{time}</option>)}
              </select>
            </label>
          </div>
        ) : line.kind === "page_break" ? (
          <div className="screenplay-page-break" role="separator" aria-label="分页" />
        ) : (
          <textarea
            ref={assignEditor}
            value={line.content}
            rows={1}
            readOnly={readOnly}
            spellCheck={line.kind !== "character" && line.kind !== "transition"}
            placeholder={isActive ? (line.kind === "action" ? "描述镜头中能够看到或听到的内容…" : `${SCREENPLAY_FORMAT_LABELS[line.kind]}内容`) : ""}
            aria-label={`第 ${line.index + 1} 行，${SCREENPLAY_FORMAT_LABELS[line.kind]}`}
            onFocus={() => onActive(line.index)}
            onChange={(event) => onReplaceLine(line.index, serializeScreenplayLine(event.target.value, line.kind))}
            onKeyDown={handleKeyDown}
            onSelect={(event) => publishSelection(event.currentTarget)}
            onMouseUp={(event) => publishSelection(event.currentTarget)}
          />
        )}
        {mentionOpen && line.kind !== "page_break" ? (
          <div className="screenplay-character-picker" role="dialog" aria-label="从角色库选择角色">
            <label>
              <MagnifyingGlass size={13} />
              <input
                autoFocus
                value={mentionQuery}
                onChange={(event) => setMentionQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") onCloseMention();
                  if (event.key === "Enter" && filteredCharacters[0]) {
                    event.preventDefault();
                    const kind = line.kind === "dual_dialogue" ? "dual_dialogue" : "character";
                    onReplaceLine(line.index, serializeScreenplayLine(filteredCharacters[0].mention, kind));
                    onCloseMention();
                    requestFocus(line.index, "end");
                  }
                }}
                placeholder="搜索角色名或 @引用"
                aria-label="搜索角色库"
              />
              <button type="button" onClick={onCloseMention} aria-label="关闭角色选择"><X size={12} /></button>
            </label>
            <div>
              {filteredCharacters.map((character) => (
                <button
                  key={character.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    const kind = line.kind === "dual_dialogue" ? "dual_dialogue" : "character";
                    onReplaceLine(line.index, serializeScreenplayLine(character.mention, kind));
                    onCloseMention();
                    requestFocus(line.index, "end");
                  }}
                >
                  <span>{character.name.slice(0, 1)}</span>
                  <strong>{character.name}</strong>
                  <small>@{character.mention}</small>
                  <Check size={12} />
                </button>
              ))}
              {!filteredCharacters.length ? <p>{characterSuggestions.length ? "没有匹配角色" : "角色库为空，可先直接输入角色名"}</p> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}, (previous, next) =>
  previous.line.index === next.line.index &&
  previous.line.raw === next.line.raw &&
  previous.line.kind === next.line.kind &&
  previous.line.start === next.line.start &&
  previous.line.end === next.line.end &&
  previous.isActive === next.isActive &&
  previous.readOnly === next.readOnly &&
  previous.mentionOpen === next.mentionOpen &&
  previous.locationOptionsId === next.locationOptionsId &&
  previous.characterSuggestions === next.characterSuggestions
);

ScreenplayBlockRow.displayName = "ScreenplayBlockRow";

export const ScreenplayBlockEditor: React.FC<Props> = ({
  body,
  lines,
  activeLineIndex,
  navigationRequest,
  readOnly = false,
  characterSuggestions,
  locationSuggestions,
  onChange,
  onActiveLineChange,
  onSelectionChange,
  onCreatePageFromLine,
  locationOptionsId = "screenplay-location-options",
}) => {
  const editorsRef = useRef(new Map<number, HTMLTextAreaElement | HTMLInputElement>());
  const pendingFocusRef = useRef<{ lineIndex: number; position: "start" | "end" | number } | null>(null);
  const [mentionLineIndex, setMentionLineIndex] = useState<number | null>(null);
  const bodyRef = useRef(body);
  const lineCountRef = useRef(lines.length);
  bodyRef.current = body;
  lineCountRef.current = lines.length;

  const registerEditor = useCallback((lineIndex: number, element: HTMLTextAreaElement | HTMLInputElement | null) => {
    if (element) editorsRef.current.set(lineIndex, element);
    else editorsRef.current.delete(lineIndex);
  }, []);

  const replaceLine = useCallback((lineIndex: number, raw: string) => {
    onChange(replaceScreenplayLine(bodyRef.current, lineIndex, raw));
  }, [onChange]);

  const insertAfter = useCallback((lineIndex: number, raw: string) => {
    onChange(insertScreenplayLine(bodyRef.current, lineIndex, raw));
  }, [onChange]);

  const splitLine = useCallback((line: ScreenplayLine, selectionStart: number, selectionEnd: number) => {
    onChange(splitScreenplayLineAtSelection(bodyRef.current, line, selectionStart, selectionEnd));
  }, [onChange]);

  const mergeWithPrevious = useCallback((line: ScreenplayLine) => {
    const merged = mergeScreenplayLineWithPrevious(bodyRef.current, line);
    onChange(merged.body);
    return merged.cursor;
  }, [onChange]);

  const focusLine = useCallback((lineIndex: number, position: "start" | "end" | number = "start", waitForMount = false) => {
    const safeIndex = waitForMount
      ? Math.max(0, lineIndex)
      : Math.min(lineCountRef.current - 1, Math.max(0, lineIndex));
    pendingFocusRef.current = { lineIndex: safeIndex, position };
    onActiveLineChange(safeIndex);
    requestAnimationFrame(() => {
      const editor = editorsRef.current.get(safeIndex);
      if (!editor) return;
      editor.focus();
      const cursor = typeof position === "number"
        ? Math.min(editor.value.length, Math.max(0, position))
        : position === "end" ? editor.value.length : 0;
      editor.setSelectionRange(cursor, cursor);
      editor.scrollIntoView({ block: "center", behavior: "smooth" });
      pendingFocusRef.current = null;
    });
  }, [onActiveLineChange]);

  useEffect(() => {
    if (!navigationRequest) return;
    focusLine(navigationRequest.lineIndex, "start");
  // The request is intentionally edge-triggered by its id.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationRequest?.id]);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const editor = editorsRef.current.get(pending.lineIndex);
    if (!editor) return;
    editor.focus();
    const cursor = typeof pending.position === "number"
      ? Math.min(editor.value.length, Math.max(0, pending.position))
      : pending.position === "end" ? editor.value.length : 0;
    editor.setSelectionRange(cursor, cursor);
    pendingFocusRef.current = null;
  }, [lines.length]);

  const uniqueCharacters = useMemo(() => {
    const seen = new Set<string>();
    return characterSuggestions.filter((character) => {
      const key = character.id || character.mention;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [characterSuggestions]);
  const uniqueLocations = useMemo(() => Array.from(new Set(locationSuggestions)), [locationSuggestions]);

  return (
    <div className="screenplay-block-editor" role="textbox" aria-multiline="true" aria-label="可视化剧本编辑器">
      <datalist id={locationOptionsId}>
        {uniqueLocations.map((name) => <option key={name} value={name} />)}
      </datalist>
      {lines.map((line) => (
        <ScreenplayBlockRow
          key={line.index}
          line={line}
          isActive={activeLineIndex === line.index}
          readOnly={readOnly}
          registerEditor={registerEditor}
          requestFocus={focusLine}
          onReplaceLine={replaceLine}
          onInsertAfter={insertAfter}
          onSplitLine={splitLine}
          onMergeWithPrevious={mergeWithPrevious}
          onCreatePageFromLine={onCreatePageFromLine}
          onActive={onActiveLineChange}
          onSelectionChange={onSelectionChange}
          characterSuggestions={uniqueCharacters}
          mentionOpen={mentionLineIndex === line.index}
          onOpenMention={setMentionLineIndex}
          onCloseMention={() => setMentionLineIndex(null)}
          locationOptionsId={locationOptionsId}
        />
      ))}
      {!lines.length ? (
        <button type="button" className="screenplay-empty-editor" onClick={() => onChange(serializeSceneHeading({ boundary: "INT.", location: "LOCATION", time: "DAY" }))}>
          <FilmSlate size={24} />
          <strong>写下第一个场景</strong>
          <span>无需记忆 Fountain 标记，从地点和时间开始。</span>
        </button>
      ) : null}
    </div>
  );
};
