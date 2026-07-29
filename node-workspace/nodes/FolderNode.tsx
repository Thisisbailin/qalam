import React from "react";
import { FileText, Folder } from "lucide-react";
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

  return (
    <BaseNode
      title={title}
      selected={selected}
      variant="default"
      nodeType={isManus ? "manus-folder" : "folder"}
      inputs={isManus ? [] : ["text"]}
      outputs={isManus ? ["contains"] : ["text"]}
    >
      <div className={`folder-node-body ${isManus ? "folder-node-body--manus" : ""}`}>
        <div className="folder-node-icon" aria-hidden="true">
          {isManus ? <FileText size={28} strokeWidth={1.65} /> : <Folder size={28} strokeWidth={1.75} />}
        </div>
        <div className="folder-node-copy">
          <span>{isManus ? "MANUS" : "Folder"}</span>
          <strong>{title}</strong>
          {isManus ? <small>{memberCount} 个剧本文档</small> : null}
        </div>
      </div>
    </BaseNode>
  );
};
