import React from "react";
import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";
import { EdgeDisconnectControl } from "./DisconnectableEdge";

export const WrapperMembershipEdge: React.FC<EdgeProps> = ({
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
    curvature: 0.28,
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
