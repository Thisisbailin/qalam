import React from "react";
import { Folder } from "lucide-react";
import { Paperclip } from "@phosphor-icons/react";
import { BaseNode } from "./BaseNode";
import type { FolderNodeData } from "../types";

type Props = {
  id: string;
  data: FolderNodeData;
  selected?: boolean;
};

export const FolderNode: React.FC<Props> = ({ data, selected }) => {
  const title = data.title || "文件夹";
  const isManus = data.folderKind === "manus";
  const memberCount = typeof data.wrapperMemberCount === "number" ? data.wrapperMemberCount : 0;
  const isCollapsed = data.wrapperCollapsed === true;
  const preview = typeof data.wrapperPreview === "string" ? data.wrapperPreview.trim() : "";
  const previewLines = (preview || "FADE IN:\n\nINT. STUDIO - DAY\n\n光线落在稿纸上。\n故事从这里开始。")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);

  if (isManus) {
    return (
      <BaseNode
        title={title}
        selected={selected}
        variant="default"
        nodeType="manus-folder"
        inputs={[]}
        outputs={["contains"]}
      >
        <article
          className="manus-wrapper-node"
          data-state={isCollapsed ? "collapsed" : "expanded"}
          aria-label={`${title}，Manus，${memberCount} 张稿纸，${isCollapsed ? "已收起" : "已展开"}`}
        >
          <header className="manus-wrapper-node__title" title={title}>{title}</header>
          <div className="manus-wrapper-node__stack" aria-hidden="true">
            <span className="manus-wrapper-node__sheet manus-wrapper-node__sheet--back" />
            <span className="manus-wrapper-node__sheet manus-wrapper-node__sheet--middle" />
            <div className="manus-wrapper-node__sheet manus-wrapper-node__sheet--front">
              <Paperclip
                className="manus-wrapper-node__clip"
                size={48}
                weight="light"
                aria-hidden="true"
              />
              <div className="manus-wrapper-node__page-head">
                <span>FADE IN:</span>
                <span>{String(Math.max(memberCount, 1)).padStart(2, "0")}</span>
              </div>
              <div className="manus-wrapper-node__script">
                {previewLines.map((line, index) => (
                  <span key={`${line}-${index}`}>{line}</span>
                ))}
              </div>
              <span className="manus-wrapper-node__format">FOUNTAIN · DRAFT</span>
            </div>
          </div>
          <footer className="manus-wrapper-node__footer">
            <strong>Manus</strong>
          </footer>
        </article>
      </BaseNode>
    );
  }

  return (
    <BaseNode
      title={title}
      selected={selected}
      variant="default"
      nodeType="folder"
      inputs={["text"]}
      outputs={["text"]}
    >
      <div className="folder-node-body">
        <div className="folder-node-icon" aria-hidden="true">
          <Folder size={28} strokeWidth={1.75} />
        </div>
        <div className="folder-node-copy">
          <span>Folder</span>
          <strong>{title}</strong>
        </div>
      </div>
    </BaseNode>
  );
};
