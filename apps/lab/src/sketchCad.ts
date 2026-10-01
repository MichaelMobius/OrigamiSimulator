import {
  projectVertices2D,
  type EdgeAssignment,
  type NormalizedFoldGraph,
  type Vec2,
} from "../../../packages/core/src/index";
import { GeometryEditError } from "./geometryEditor";
import { moveVertexSafely } from "./precisionCad";

export const DRAW_ASSIGNMENTS = ["V", "M", "F", "C", "U"] as const satisfies readonly EdgeAssignment[];

export function foldAngleForAssignment(assignment: EdgeAssignment, magnitude = 180): number {
  const safeMagnitude = Number.isFinite(magnitude) ? Math.max(0, Math.min(180, Math.abs(magnitude))) : 180;
  if (assignment === "V") return safeMagnitude;
  if (assignment === "M") return -safeMagnitude;
  return 0;
}

export function pointFromLengthAngle(origin: Vec2, length: number, angleDegrees: number): Vec2 {
  if (!Number.isFinite(length) || length <= 0) {
    throw new GeometryEditError("invalid-line-length", "Line length must be greater than zero.");
  }
  if (!Number.isFinite(angleDegrees)) {
    throw new GeometryEditError("invalid-line-angle", "Line angle must be a finite number.");
  }
  const radians = angleDegrees * Math.PI / 180;
  return [
    origin[0] + Math.cos(radians) * length,
    origin[1] + Math.sin(radians) * length,
  ];
}

export function retargetEdgeFromFirstVertex(
  graph: NormalizedFoldGraph,
  edgeIndex: number,
  length: number,
  angleDegrees: number,
): NormalizedFoldGraph {
  const edge = graph.edges_vertices[edgeIndex];
  if (!edge) throw new GeometryEditError("invalid-edge", `Edge ${edgeIndex} does not exist.`);
  const points = projectVertices2D(graph.vertices_coords ?? []);
  const origin = points[edge[0]];
  if (!origin) throw new GeometryEditError("invalid-edge", `Edge ${edgeIndex} has an invalid first endpoint.`);
  const target = pointFromLengthAngle(origin, length, angleDegrees);
  return moveVertexSafely(graph, edge[1], target);
}

export function assignmentName(assignment: EdgeAssignment): string {
  switch (assignment) {
    case "V": return "Valley";
    case "M": return "Mountain";
    case "F": return "Flat";
    case "C": return "Cut";
    case "U": return "Hinge";
    case "B": return "Boundary";
    case "J": return "Join";
    default: return assignment;
  }
}
