import React from "react";
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
      nodeType="pinoard-blueprint"
    >
      <div
        className={`pinoard-blueprint ${isCollapsed ? "is-collapsed" : "is-expanded"}`}
        data-wrapper-state={isCollapsed ? "closed" : "open"}
        data-wrapper-members={memberCount}
        aria-label={`Pinoard 构思包装器，${memberCount} 条灵感，双击打开`}
      >
        <div className="pinoard-blueprint__paper-stack" aria-hidden="true">
          <span />
          <span />
        </div>

        <div className="pinoard-blueprint__sheet" aria-hidden="true">
          <span className="pinoard-blueprint__frame" />
          <div className="pinoard-blueprint__story-flow">
            <small>IDEA FLOW</small>
            <div>
              <i>I</i><span /><i>II</i><span /><i>III</i>
            </div>
          </div>
        </div>

        <div className="pinoard-blueprint__upper">
          <span className="pinoard-blueprint__frame" aria-hidden="true" />
          <div className="pinoard-blueprint__pin" aria-hidden="true">
            <span />
          </div>
          <div className="pinoard-blueprint__heading">
            <strong>{data.title || "Pinoard"}</strong>
            <span>IDEATION BLUEPRINT</span>
            <small>WORKING MAP / 01</small>
          </div>
          <svg
            className="pinoard-blueprint__route"
            viewBox="0 0 360 174"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d="M76 121 C112 73 148 132 188 89 S255 67 318 42" />
            <path className="is-dashed" d="M52 139 C105 102 135 155 188 122 S271 98 328 116" />
            <circle cx="76" cy="121" r="3.5" />
            <circle cx="188" cy="89" r="3.5" />
            <circle cx="318" cy="42" r="3.5" />
          </svg>
          <span className="pinoard-blueprint__route-label is-spark">SPARK</span>
          <span className="pinoard-blueprint__route-label is-shape">SHAPE</span>
        </div>

        <div className="pinoard-blueprint__fold-shadow" aria-hidden="true" />
        <div className="pinoard-blueprint__status">
          <strong>{String(memberCount).padStart(2, "0")}</strong>
          <span>{memberCount === 1 ? "IDEA" : "IDEAS"}</span>
          <i>{isCollapsed ? "FOLDED" : "OPEN"}</i>
        </div>
      </div>
    </BaseNode>
  );
};
