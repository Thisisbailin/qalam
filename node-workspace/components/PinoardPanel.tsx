import React, { useEffect, useMemo, useState } from "react";
import { ChatCenteredDots, Plus, Trash, X } from "@phosphor-icons/react";
import type { ProjectData } from "../../types";
import type { TextNodeData } from "../types";
import {
  addPinoardNote,
  getPinoardMembers,
  removePinoardNote,
  updatePinoardNote,
} from "../../utils/pinoardWorkspace";
import "../styles/pinoard.css";

type Props = {
  projectData: ProjectData;
  setProjectData: React.Dispatch<React.SetStateAction<ProjectData>>;
  pinoardId: string;
  initialTextNodeId?: string | null;
  onClose: () => void;
  onOpenStylo?: () => void;
};

export const PinoardPanel: React.FC<Props> = ({
  projectData,
  setProjectData,
  pinoardId,
  initialTextNodeId = null,
  onClose,
  onOpenStylo,
}) => {
  const members = useMemo(
    () => getPinoardMembers(projectData, pinoardId),
    [pinoardId, projectData.flow?.flowNodes, projectData.flow?.links]
  );
  const [activeNodeId, setActiveNodeId] = useState<string | null>(initialTextNodeId);
  const activeNote = members.find((node) => node.id === activeNodeId) || members[0] || null;

  useEffect(() => {
    if (!activeNote && members[0]) setActiveNodeId(members[0].id);
    if (activeNodeId && !members.some((node) => node.id === activeNodeId)) {
      setActiveNodeId(members[0]?.id || null);
    }
  }, [activeNodeId, activeNote, members]);

  const updateActiveNote = (patch: Partial<Pick<TextNodeData, "title" | "text">>) => {
    if (!activeNote) return;
    setProjectData((previous) => updatePinoardNote(previous, pinoardId, activeNote.id, {
      title: patch.title ?? activeNote.data.title ?? "未命名灵感",
      text: patch.text ?? activeNote.data.text ?? "",
    }));
  };

  const createNote = () => {
    let createdNodeId: string | null = null;
    setProjectData((previous) => {
      const result = addPinoardNote(previous, pinoardId);
      createdNodeId = result.nodeId;
      return result.projectData;
    });
    if (createdNodeId) setActiveNodeId(createdNodeId);
  };

  const deleteActiveNote = () => {
    if (!activeNote) return;
    const activeIndex = members.findIndex((node) => node.id === activeNote.id);
    const fallback = members[activeIndex + 1] || members[activeIndex - 1] || null;
    setActiveNodeId(fallback?.id || null);
    setProjectData((previous) => removePinoardNote(previous, pinoardId, activeNote.id));
  };

  return (
    <section className="pinoard-workspace" aria-label="Pinoard 构思工作区">
      <nav className="pinoard-workspace__actions" aria-label="Pinoard 操作">
        <button type="button" onClick={createNote} aria-label="新增灵感节点" title="新增灵感节点"><Plus size={17} weight="regular" aria-hidden="true" /></button>
        <button type="button" onClick={onOpenStylo} aria-label="打开 Stylo Agent" title="Stylo Agent"><ChatCenteredDots size={17} weight="regular" aria-hidden="true" /></button>
        <span aria-hidden="true" />
        <button type="button" onClick={onClose} aria-label="返回完整 Flow" title="返回完整 Flow"><X size={17} weight="regular" aria-hidden="true" /></button>
      </nav>

      <main className="pinoard-canvas-layout" aria-label="Pinoard 节点画布">
        {members.map((node) => {
          const isActive = node.id === activeNote?.id;
          const text = node.data.text || "";
          return (
            <article
              key={node.id}
              className={`node-card-base pinoard-canvas-node ${isActive ? "is-active" : ""}`}
              data-selected={isActive}
              data-variant="text"
              data-node-type="text"
              tabIndex={isActive ? -1 : 0}
              aria-current={isActive ? "true" : undefined}
              onClick={() => setActiveNodeId(node.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActiveNodeId(node.id);
                }
              }}
            >
              <header className="node-card-floating-header">
                <div className="node-card-header-copy">
                  {isActive ? (
                    <input
                      className="node-card-title-input nodrag"
                      value={node.data.title || ""}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => updateActiveNote({ title: event.target.value })}
                      placeholder="未命名灵感"
                      aria-label="灵感标题"
                    />
                  ) : (
                    <div className="node-card-title">{node.data.title || "未命名灵感"}</div>
                  )}
                </div>
                {isActive ? <button type="button" className="pinoard-delete-node" onClick={(event) => { event.stopPropagation(); deleteActiveNote(); }} aria-label="删除当前灵感节点" title="删除当前灵感节点"><Trash size={14} weight="regular" aria-hidden="true" /></button> : null}
              </header>
              <div className="node-card-shell">
                <div className="node-card-body">
                  <div className="text-node-shell" data-has-content={text.trim().length > 0 ? "true" : "false"}>
                    {isActive ? (
                      <textarea
                        className="text-node-editor nodrag"
                        value={text}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => updateActiveNote({ text: event.target.value })}
                        placeholder="使用 Markdown 记录文本…"
                        aria-label="灵感内容"
                      />
                    ) : <div className="text-node-editor pinoard-node-preview">{text}</div>}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
        {!members.length ? <button type="button" className="pinoard-empty-state" onClick={createNote} aria-label="新增灵感节点"><Plus size={17} weight="regular" aria-hidden="true" /></button> : null}
      </main>
    </section>
  );
};
