import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChatCenteredDots,
  NotePencil,
  Plus,
  PushPinSimple,
  Trash,
  X,
} from "@phosphor-icons/react";
import type { ProjectData } from "../../types";
import type { TextNodeData } from "../types";
import {
  addPinoardNote,
  getPinoardMembers,
  removePinoardNote,
  updatePinoardNote,
} from "../../utils/pinoardWorkspace";
import "../styles/pinoard.css";

type NoteDraft = {
  title: string;
  text: string;
};

type Props = {
  projectData: ProjectData;
  setProjectData: React.Dispatch<React.SetStateAction<ProjectData>>;
  pinoardNodeId: string;
  initialTextNodeId?: string | null;
  isAgentOpen: boolean;
  onOpenAgent: () => void;
  onClose: () => void;
};

const readDraft = (data: TextNodeData): NoteDraft => ({
  title: data.title || "未命名灵感",
  text: data.text || "",
});

export const PinoardPanel: React.FC<Props> = ({
  projectData,
  setProjectData,
  pinoardNodeId,
  initialTextNodeId,
  isAgentOpen,
  onOpenAgent,
  onClose,
}) => {
  const members = useMemo(
    () => getPinoardMembers(projectData, pinoardNodeId),
    [pinoardNodeId, projectData]
  );
  const [currentTextNodeId, setCurrentTextNodeId] = useState<string | null>(
    initialTextNodeId || members[0]?.id || null
  );
  const [drafts, setDrafts] = useState<Record<string, NoteDraft>>(() =>
    Object.fromEntries(
      members.map((node) => [node.id, readDraft(node.data as TextNodeData)])
    )
  );
  const draftsRef = useRef(drafts);
  const saveTimersRef = useRef(new Map<string, number>());
  const initializedEmptyRef = useRef(false);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      members.forEach((node) => {
        if (!next[node.id]) next[node.id] = readDraft(node.data as TextNodeData);
      });
      Object.keys(next).forEach((nodeId) => {
        if (!members.some((node) => node.id === nodeId)) delete next[nodeId];
      });
      return next;
    });
  }, [members]);

  useEffect(() => {
    if (
      currentTextNodeId &&
      members.some((node) => node.id === currentTextNodeId)
    ) {
      return;
    }
    setCurrentTextNodeId(initialTextNodeId || members[0]?.id || null);
  }, [currentTextNodeId, initialTextNodeId, members]);

  const commitDraft = useCallback(
    (nodeId: string, draft = draftsRef.current[nodeId]) => {
      if (!draft) return;
      const timer = saveTimersRef.current.get(nodeId);
      if (timer) window.clearTimeout(timer);
      saveTimersRef.current.delete(nodeId);
      setProjectData((previous) =>
        updatePinoardNote(previous, pinoardNodeId, nodeId, draft)
      );
    },
    [pinoardNodeId, setProjectData]
  );

  const scheduleDraft = useCallback(
    (nodeId: string, patch: Partial<NoteDraft>) => {
      setDrafts((current) => {
        const nextDraft = {
          ...(current[nodeId] || { title: "未命名灵感", text: "" }),
          ...patch,
        };
        draftsRef.current = { ...current, [nodeId]: nextDraft };
        return draftsRef.current;
      });
      const timer = saveTimersRef.current.get(nodeId);
      if (timer) window.clearTimeout(timer);
      saveTimersRef.current.set(
        nodeId,
        window.setTimeout(() => commitDraft(nodeId), 480)
      );
    },
    [commitDraft]
  );

  const createNote = useCallback(() => {
    let nextNodeId: string | null = null;
    setProjectData((previous) => {
      const result = addPinoardNote(previous, pinoardNodeId);
      nextNodeId = result.nodeId;
      return result.projectData;
    });
    window.setTimeout(() => {
      if (nextNodeId) setCurrentTextNodeId(nextNodeId);
    }, 0);
  }, [pinoardNodeId, setProjectData]);

  useEffect(() => {
    if (members.length || initializedEmptyRef.current) return;
    initializedEmptyRef.current = true;
    const timer = window.setTimeout(createNote, 0);
    return () => window.clearTimeout(timer);
  }, [createNote, members.length]);

  useEffect(
    () => () => {
      saveTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      Object.entries(draftsRef.current).forEach(([nodeId, draft]) => {
        setProjectData((previous) =>
          updatePinoardNote(previous, pinoardNodeId, nodeId, draft)
        );
      });
    },
    [pinoardNodeId, setProjectData]
  );

  const deleteNote = useCallback(
    (nodeId: string) => {
      const remaining = members.filter((node) => node.id !== nodeId);
      setProjectData((previous) =>
        removePinoardNote(previous, pinoardNodeId, nodeId)
      );
      setCurrentTextNodeId((current) =>
        current === nodeId ? remaining[0]?.id || null : current
      );
    },
    [members, pinoardNodeId, setProjectData]
  );

  const currentMember =
    members.find((node) => node.id === currentTextNodeId) || members[0] || null;
  const currentDraft = currentMember
    ? drafts[currentMember.id] || readDraft(currentMember.data as TextNodeData)
    : null;
  const railMembers = isAgentOpen
    ? members
    : members.filter((node) => node.id !== currentMember?.id);
  const leftMembers = railMembers.filter((_, index) => index % 2 === 0);
  const rightMembers = railMembers.filter((_, index) => index % 2 === 1);

  const renderRailNote = (node: (typeof members)[number]) => {
    const draft = drafts[node.id] || readDraft(node.data as TextNodeData);
    const isCurrent = node.id === currentMember?.id;
    return (
      <article
        className={`pinoard-rail-note ${isCurrent ? "is-current" : ""}`}
        key={node.id}
        onDoubleClick={() => setCurrentTextNodeId(node.id)}
      >
        <button
          type="button"
          className="pinoard-rail-note__select"
          aria-label={`设为当前灵感：${draft.title}`}
          onClick={() => setCurrentTextNodeId(node.id)}
        />
        <input
          value={draft.title}
          aria-label="灵感标题"
          onChange={(event) =>
            scheduleDraft(node.id, { title: event.target.value })
          }
          onBlur={() => commitDraft(node.id)}
        />
        <textarea
          value={draft.text}
          aria-label={`${draft.title}正文`}
          placeholder="写下一条尚未成形的想法…"
          onChange={(event) =>
            scheduleDraft(node.id, { text: event.target.value })
          }
          onFocus={() => setCurrentTextNodeId(node.id)}
          onBlur={() => commitDraft(node.id)}
        />
        <button
          type="button"
          className="pinoard-rail-note__delete"
          aria-label={`删除${draft.title}`}
          onClick={() => deleteNote(node.id)}
        >
          <Trash size={13} aria-hidden="true" />
        </button>
      </article>
    );
  };

  return (
    <section
      className={`pinoard-workspace ${isAgentOpen ? "is-agent-open" : "is-editing"}`}
      aria-label="Pinoard 构思工作区"
    >
      <header className="pinoard-toolbar">
        <div className="pinoard-toolbar__identity">
          <PushPinSimple size={17} weight="fill" aria-hidden="true" />
          <div>
            <strong>Pinoard</strong>
            <span>{members.length} 条灵感</span>
          </div>
        </div>
        <div className="pinoard-toolbar__actions">
          <button type="button" onClick={createNote} aria-label="新增灵感">
            <Plus size={17} aria-hidden="true" />
            <span>新增</span>
          </button>
          <button
            type="button"
            className={isAgentOpen ? "is-active" : ""}
            onClick={onOpenAgent}
            aria-label="唤起 Stylo Agent"
          >
            <ChatCenteredDots size={18} aria-hidden="true" />
            <span>Agent</span>
          </button>
          <button type="button" onClick={onClose} aria-label="关闭 Pinoard">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="pinoard-stage">
        <div className="pinoard-stage__paper" aria-hidden="true">
          <span className="pinoard-stage__underlay is-back" />
          <span className="pinoard-stage__underlay is-middle" />
          <span className="pinoard-stage__sheet" />
          <span className="pinoard-stage__upper-fold" />
          <span className="pinoard-stage__fold-line" />
          <span className="pinoard-stage__pin"><i /></span>
          <span className="pinoard-stage__mark">PINOARD / IDEATION BLUEPRINT</span>
        </div>

        <aside className="pinoard-rail is-left" aria-label="左侧灵感">
          {leftMembers.map(renderRailNote)}
        </aside>

        {isAgentOpen ? (
          <div className="pinoard-agent-stage" aria-label="Stylo Agent 中枢">
            <div>
              <ChatCenteredDots size={18} aria-hidden="true" />
              <span>Agent 正在统合这面灵感墙</span>
            </div>
          </div>
        ) : currentMember && currentDraft ? (
          <article className="pinoard-current-note">
            <div className="pinoard-current-note__meta">
              <span>
                <NotePencil size={15} aria-hidden="true" />
                当前灵感
              </span>
              <button
                type="button"
                aria-label={`删除${currentDraft.title}`}
                onClick={() => deleteNote(currentMember.id)}
              >
                <Trash size={15} aria-hidden="true" />
              </button>
            </div>
            <input
              className="pinoard-current-note__title"
              value={currentDraft.title}
              aria-label="当前灵感标题"
              onChange={(event) =>
                scheduleDraft(currentMember.id, {
                  title: event.target.value,
                })
              }
              onBlur={() => commitDraft(currentMember.id)}
            />
            <textarea
              className="pinoard-current-note__editor"
              value={currentDraft.text}
              aria-label={`${currentDraft.title}正文`}
              placeholder="让这条灵感继续生长…"
              autoFocus
              onChange={(event) =>
                scheduleDraft(currentMember.id, { text: event.target.value })
              }
              onBlur={() => commitDraft(currentMember.id)}
            />
          </article>
        ) : (
          <div className="pinoard-current-note is-loading" role="status">
            <PushPinSimple size={22} weight="fill" aria-hidden="true" />
            <span>正在准备第一条灵感</span>
          </div>
        )}

        <aside className="pinoard-rail is-right" aria-label="右侧灵感">
          {rightMembers.map(renderRailNote)}
        </aside>
      </div>
    </section>
  );
};
