import React, { useCallback } from "react";
import {
  BaseEdge,
  EdgeProps,
  EdgeToolbar,
  getBezierPath,
  useReactFlow,
} from "@xyflow/react";
import { LinkBreak } from "@phosphor-icons/react";

type EdgeDisconnectControlProps = {
  edgeId: string;
  labelX: number;
  labelY: number;
  selected?: boolean;
  deletable?: boolean;
};

export const EdgeDisconnectControl: React.FC<EdgeDisconnectControlProps> = ({
  edgeId,
  labelX,
  labelY,
  selected,
  deletable,
}) => {
  const { deleteElements } = useReactFlow();
  const handleDisconnect = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      void deleteElements({ edges: [{ id: edgeId }] });
    },
    [deleteElements, edgeId]
  );

  if (!selected || deletable === false) return null;

  return (
    <EdgeToolbar
      edgeId={edgeId}
      x={labelX}
      y={labelY}
      isVisible
      className="flow-edge-disconnect-toolbar"
    >
      <button
        type="button"
        className="flow-edge-disconnect nodrag nopan"
        onClick={handleDisconnect}
        onPointerDown={(event) => event.stopPropagation()}
        aria-label="断开连接"
        title="断开连接"
      >
        <LinkBreak size={17} weight="regular" aria-hidden="true" />
      </button>
    </EdgeToolbar>
  );
};

export const DisconnectableEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  markerStart,
  style,
  selected,
  deletable,
  interactionWidth,
}) => {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={style}
        interactionWidth={interactionWidth || 28}
      />
      <EdgeDisconnectControl
        edgeId={id}
        labelX={labelX}
        labelY={labelY}
        selected={selected}
        deletable={deletable}
      />
    </>
  );
};
