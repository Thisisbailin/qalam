import React from "react";
import { PushPinSimple } from "@phosphor-icons/react";
import type { PinoardNodeData } from "../types";
import { BaseNode } from "./BaseNode";

type Props = {
  data: PinoardNodeData;
  selected?: boolean;
};

export const PinoardNode: React.FC<Props> = ({ data, selected }) => {
  const memberCount =
    typeof data.wrapperMemberCount === "number" ? data.wrapperMemberCount : 0;
  const isCollapsed = data.wrapperCollapsed === true;

  return (
    <BaseNode
      title={data.title || "Pinoard"}
      inputs={["multi", "text"]}
      outputs={["text"]}
      selected={selected}
      variant="media"
      nodeType="pinoard-wrapper"
    >
      <article
        className="pinoard-wrapper-node"
        data-wrapper-state={isCollapsed ? "closed" : "open"}
        data-wrapper-members={memberCount}
        aria-label={`Pinoard 构思包装器，${memberCount} 条灵感，双击打开`}
      >
        <div className="pinoard-wrapper-node__stack" aria-hidden="true">
          <span className="pinoard-wrapper-node__sheet pinoard-wrapper-node__sheet--back" />
          <span className="pinoard-wrapper-node__sheet pinoard-wrapper-node__sheet--middle" />
          <div className="pinoard-wrapper-node__sheet pinoard-wrapper-node__sheet--front">
            <div className="pinoard-wrapper-node__head">
              <span>IDEA BOARD</span>
              <span>{String(memberCount).padStart(2, "0")}</span>
            </div>
            <strong>{data.title || "Pinoard"}</strong>
            <div className="pinoard-wrapper-node__lines"><i /><i /><i /><i /></div>
            <span className="pinoard-wrapper-node__format">NOTES · {isCollapsed ? "FOLDED" : "OPEN"}</span>
          </div>
          <PushPinSimple className="pinoard-wrapper-node__pin" size={38} weight="fill" />
        </div>
      </article>
    </BaseNode>
  );
};
