import React, { useMemo } from "react";
import { BaseNode } from "./BaseNode";
import type { IdentityCardNodeData, ImageInputNodeData } from "../types";
import { useNodeFlowStore } from "../store/nodeFlowStore";

type Props = {
  id: string;
  data: IdentityCardNodeData;
  selected?: boolean;
};

export const CompactIdentityCardNode: React.FC<Props> = ({ id, data, selected }) => {
  const roles = useNodeFlowStore((state) => state.nodeFlowContext.roles || []);
  const nodes = useNodeFlowStore((state) => state.nodes);
  const links = useNodeFlowStore((state) => state.links);
  const identity = useMemo(
    () => roles.find((role) => role.id === data.identityId),
    [data.identityId, roles]
  );
  const coverImage = useMemo(() => {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    for (const link of links) {
      const connectedId = link.source === id ? link.target : link.target === id ? link.source : "";
      const node = connectedId ? nodeById.get(connectedId) : undefined;
      if (node?.type !== "imageInput") continue;
      const image = (node.data as ImageInputNodeData).image;
      if (typeof image === "string" && image) return image;
    }
    return "";
  }, [id, links, nodes]);
  const name = identity?.displayName || identity?.name || data.title || "未命名身份";
  const fallbackLetter = name.trim().slice(0, 1).toLocaleUpperCase() || "I";
  const isCollapsed = data.wrapperCollapsed === true;
  const stateLabel = isCollapsed ? "已合上，单击展开内容" : "微微打开，单击收起内容";
  return (
    <BaseNode
      title={name}
      inputs={["image", "audio", "video", "text"]}
      outputs={["text"]}
      selected={selected}
      variant="media"
      nodeType="lookbook-cover"
    >
      <div
        className={`lookbook-node-cover ${isCollapsed ? "is-closed" : "is-open"} ${coverImage ? "has-cover-image" : "is-empty"}`}
        aria-label={`${name} Lookbook，${stateLabel}`}
        data-wrapper-state={isCollapsed ? "closed" : "open"}
        data-wrapper-members={typeof data.wrapperMemberCount === "number" ? data.wrapperMemberCount : 0}
      >
        <header className="lookbook-node-cover__wrapper-title" title={name}>{name}</header>
        <div className="lookbook-node-cover__stack">
          <div className="lookbook-node-cover__back-board" aria-hidden="true" />
          <div className="lookbook-node-cover__page-block" aria-hidden="true" />
          <div className="lookbook-node-cover__front-board">
            <span className="lookbook-node-cover__edition">LOOKBOOK / 01</span>
            <div className="lookbook-node-cover__visual">
              {coverImage ? (
                <img src={coverImage} alt={`${name} Lookbook 封面`} draggable={false} />
              ) : (
                <div className="lookbook-node-cover__placeholder" aria-label="尚未连接封面图片">
                  <span>{fallbackLetter}</span>
                </div>
              )}
            </div>
            <span className="lookbook-node-cover__imprint">STYLO PHOTOGRAPHIC ARCHIVE</span>
          </div>
        </div>
        <footer className="lookbook-node-cover__footer"><strong>Lookbook</strong></footer>
      </div>
    </BaseNode>
  );
};
