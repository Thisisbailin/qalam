import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { HandleType } from "../types";
import type { NodeCardColor } from "../types";
import { useNodeFlowStore } from "../store/nodeFlowStore";

type NodeHandleSpec =
  | HandleType
  | {
      id: HandleType;
      top?: string;
      hidden?: boolean;
      className?: string;
      label?: string;
    };

type Props = {
  title: string;
  onTitleChange?: (newTitle: string) => void;
  children?: React.ReactNode;
  inputs?: NodeHandleSpec[];
  outputs?: NodeHandleSpec[];
  selected?: boolean;
  variant?: "default" | "text" | "media";
  nodeType?: string;
  cardColor?: NodeCardColor;
  headerActions?: React.ReactNode;
};

export const BaseNode: React.FC<Props> = ({
  title,
  onTitleChange,
  children,
  inputs = [],
  outputs = [],
  selected,
  variant = "default",
  nodeType,
  cardColor = "none",
  headerActions,
}) => {
  const [draftTitle, setDraftTitle] = useState(title);
  const readingMode = useNodeFlowStore((state) => state.readingMode);
  const isIdentityMode = readingMode === "identity";

  useEffect(() => {
    setDraftTitle(title);
  }, [title]);

  const commitTitle = useCallback(() => {
    const nextTitle = draftTitle.trim() || title;
    if (nextTitle !== draftTitle) setDraftTitle(nextTitle);
    if (onTitleChange && nextTitle !== title) onTitleChange(nextTitle);
  }, [draftTitle, onTitleChange, title]);

  const getHandleTop = useCallback((index: number, count: number) => {
    if (count <= 1) return "50%";
    const start = 24;
    const end = 76;
    const ratio = count === 1 ? 0.5 : index / (count - 1);
    return `${start + (end - start) * ratio}%`;
  }, []);

  const resolveHandleSpec = useCallback(
    (handle: NodeHandleSpec, index: number, count: number) =>
      typeof handle === "string"
        ? { id: handle, top: getHandleTop(index, count), hidden: false, className: "", label: "" }
        : {
            id: handle.id,
            top: handle.top || getHandleTop(index, count),
            hidden: !!handle.hidden,
            className: handle.className || "",
            label: handle.label || "",
          },
    [getHandleTop]
  );

  const normalizeHandleSpecs = useCallback(
    (handles: NodeHandleSpec[]) => {
      const resolved = handles.map((handle, index) => resolveHandleSpec(handle, index, handles.length));
      const visibleMultiHandle = resolved.some((handle) => handle.id === "multi" && !handle.hidden);
      const visibleTypedHandles = resolved.filter((handle) => handle.id !== "multi" && !handle.hidden);
      if (visibleMultiHandle || visibleTypedHandles.length <= 1) return resolved;
      return [
        {
          id: "multi" as HandleType,
          top: "50%",
          hidden: false,
          className: "node-card-port--multi",
          label: "",
        },
        ...resolved.map((handle) =>
          handle.id === "multi"
            ? handle
            : {
                ...handle,
                top: "50%",
                hidden: true,
                label: "",
              }
        ),
      ];
    },
    [resolveHandleSpec]
  );

  const normalizedInputs = useMemo(() => normalizeHandleSpecs(inputs), [inputs, normalizeHandleSpecs]);
  const normalizedOutputs = useMemo(() => normalizeHandleSpecs(outputs), [outputs, normalizeHandleSpecs]);

  return (
    <div
      className="node-card-base transition-shadow duration-300 overflow-visible text-xs flex flex-col"
      data-selected={!!selected}
      data-variant={variant}
      data-node-type={nodeType || ""}
      data-card-color={cardColor}
      data-reading-mode={readingMode}
    >
      <div className="node-card-floating-header">
        <div className="node-card-header-copy min-w-0 flex-1">
          {onTitleChange && !isIdentityMode ? (
            <input
              className="node-card-title-input nodrag"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={commitTitle}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitTitle();
                  event.currentTarget.blur();
                }
              }}
            />
          ) : (
            <div className="node-card-title">{title}</div>
          )}
        </div>
        {!isIdentityMode && headerActions ? <div className="flex items-center gap-1">{headerActions}</div> : null}
      </div>

      <div className="node-card-shell">
        {!isIdentityMode ? <div className="node-card-body">{children}</div> : null}
      </div>

      {normalizedInputs.map((spec, idx) => {
        return (
          <Handle
            key={`in-${spec.id}-${idx}`}
            type="target"
            position={Position.Left}
            id={spec.id}
            style={{ top: spec.top }}
            className={`node-card-port node-card-port--input ${spec.hidden ? "node-card-port--ghost" : ""} ${spec.className}`.trim()}
            data-handletype={spec.id}
          />
        );
      })}

      {normalizedOutputs.map((spec, idx) => {
        return (
          <Handle
            key={`out-${spec.id}-${idx}`}
            type="source"
            position={Position.Right}
            id={spec.id}
            style={{ top: spec.top }}
            className={`node-card-port node-card-port--output ${spec.hidden ? "node-card-port--ghost" : ""} ${spec.className}`.trim()}
            data-handletype={spec.id}
          />
        );
      })}
    </div>
  );
};
