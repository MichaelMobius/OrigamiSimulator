import {
  chooseProjectionAxes,
  isSimpleFace,
  pointOnSegment,
  projectVertices2D,
  segmentIntersectionParameters,
  type Vec2,
} from "../../../packages/core/src/geometry/planar.ts";
import type { NormalizedFoldGraph, Vertex } from "../../../packages/core/src/fold/types.ts";
import { GeometryEditError } from "./geometryEditor.ts";

const EPSILON = 1e-7;
const ANGLE_CANDIDATES = [
  -150, -135, -120, -90, -60, -45, -30,
  0,
  30, 45, 60, 90, 120, 135, 150, 180,
] as const;

export interface EdgeMeasurement {
  length: number;
  angleDegrees: number;
  midpoint: Vec2;
}

export function edgeMeasurement(graph: NormalizedFoldGraph, edgeIndex: number): EdgeMeasurement | undefined {
  const edge = graph.edges_vertices[edgeIndex];
  if (!edge) return undefined;
  const points = projectVertices2D(graph.vertices_coords ?? []);
  const a = points[edge[0]];
  const b = points[edge[1]];
  if (!a || !b) return undefined;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return {
    length: Math.hypot(dx, dy),
    angleDegrees: normalizeAngle(Math.atan2(dy, dx) * 180 / Math.PI),
    midpoint: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
  };
}

export function pointMeasurement(origin: Vec2, point: Vec2): { length: number; angleDegrees: number } {
  const dx = point[0] - origin[0];
  const dy = point[1] - origin[1];
  return {
    length: Math.hypot(dx, dy),
    angleDegrees: normalizeAngle(Math.atan2(dy, dx) * 180 / Math.PI),
  };
}

export function angularSnapPoint(
  graph: NormalizedFoldGraph,
  startVertex: number,
  rawPoint: Vec2,
  thresholdDegrees = 7,
): { point: Vec2; angleDegrees: number; snapped: boolean } {
  const points = projectVertices2D(graph.vertices_coords ?? []);
  const origin = points[startVertex];
  if (!origin) return { point: rawPoint, angleDegrees: 0, snapped: false };

  const dx = rawPoint[0] - origin[0];
  const dy = rawPoint[1] - origin[1];
  const radius = Math.hypot(dx, dy);
  if (radius <= EPSILON) return { point: rawPoint, angleDegrees: 0, snapped: false };

  const rawAngle = normalizeAngle(Math.atan2(dy, dx) * 180 / Math.PI);
  let best = rawAngle;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of ANGLE_CANDIDATES) {
    const distance = circularAngleDistance(rawAngle, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (bestDistance > thresholdDegrees) {
    return { point: rawPoint, angleDegrees: rawAngle, snapped: false };
  }
  const radians = best * Math.PI / 180;
  return {
    point: [origin[0] + Math.cos(radians) * radius, origin[1] + Math.sin(radians) * radius],
    angleDegrees: best,
    snapped: true,
  };
}

export function moveVertexSafely(
  graph: NormalizedFoldGraph,
  vertexIndex: number,
  point: Vec2,
): NormalizedFoldGraph {
  const vertices = graph.vertices_coords ?? [];
  const current = vertices[vertexIndex];
  if (!current) throw new GeometryEditError("invalid-vertex", `Vertex ${vertexIndex} does not exist.`);
  if (!point.every(Number.isFinite)) throw new GeometryEditError("invalid-coordinate", "Vertex coordinates must be finite.");

  const next = structuredClone(graph) as NormalizedFoldGraph;
  const nextVertices = (next.vertices_coords ?? []).map((vertex) => [...vertex] as Vertex);
  const axes = chooseProjectionAxes(nextVertices);
  const moved = [...nextVertices[vertexIndex]!] as number[];
  while (moved.length <= Math.max(...axes)) moved.push(0);
  moved[axes[0]] = point[0];
  moved[axes[1]] = point[1];
  nextVertices[vertexIndex] = moved as Vertex;
  next.vertices_coords = nextVertices;

  validateMovedGeometry(next, vertexIndex);
  return next;
}

export function mirrorPattern(
  graph: NormalizedFoldGraph,
  axis: "horizontal" | "vertical",
): NormalizedFoldGraph {
  const vertices = graph.vertices_coords ?? [];
  if (vertices.length === 0) return structuredClone(graph) as NormalizedFoldGraph;
  const axes = chooseProjectionAxes(vertices);
  const points = vertices.map((vertex) => [
    Number(vertex[axes[0]] ?? 0),
    Number(vertex[axes[1]] ?? 0),
  ] as Vec2);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;

  const next = structuredClone(graph) as NormalizedFoldGraph;
  next.vertices_coords = vertices.map((vertex, index) => {
    const copy = [...vertex] as number[];
    while (copy.length <= Math.max(...axes)) copy.push(0);
    if (axis === "vertical") copy[axes[0]] = 2 * centerX - points[index]![0];
    else copy[axes[1]] = 2 * centerY - points[index]![1];
    return copy as Vertex;
  });
  // Reflection reverses winding; reverse faces to preserve the original front/back convention.
  if (next.faces_vertices) next.faces_vertices = next.faces_vertices.map((face) => [...face].reverse());
  return next;
}

export function snapMovePointToGrid(point: Vec2, gridSize: number): Vec2 {
  if (!(Number.isFinite(gridSize) && gridSize > 0)) return point;
  return [
    Math.round(point[0] / gridSize) * gridSize,
    Math.round(point[1] / gridSize) * gridSize,
  ];
}

function validateMovedGeometry(graph: NormalizedFoldGraph, movedVertex: number): void {
  const points = projectVertices2D(graph.vertices_coords ?? []);
  const movedPoint = points[movedVertex]!;
  for (let index = 0; index < points.length; index += 1) {
    if (index === movedVertex) continue;
    if (distanceSquared(movedPoint, points[index]!) <= EPSILON * EPSILON) {
      throw new GeometryEditError("coincident-vertex", "A moved vertex cannot occupy the same point as another vertex.");
    }
  }

  graph.edges_vertices.forEach(([a, b], edgeIndex) => {
    const pa = points[a];
    const pb = points[b];
    if (!pa || !pb || Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) <= EPSILON) {
      throw new GeometryEditError("degenerate-edge", `Moving the vertex would collapse edge ${edgeIndex}.`);
    }
  });

  for (const face of graph.faces_vertices ?? []) {
    if (face.includes(movedVertex) && !isSimpleFace(face, graph.vertices_coords ?? [])) {
      throw new GeometryEditError("invalid-face-after-move", "Moving the vertex would make a face self-intersect or collapse.");
    }
  }

  for (let i = 0; i < graph.edges_vertices.length; i += 1) {
    const [a, b] = graph.edges_vertices[i]!;
    const pa = points[a]!;
    const pb = points[b]!;
    for (let j = i + 1; j < graph.edges_vertices.length; j += 1) {
      const [c, d] = graph.edges_vertices[j]!;
      if (a === c || a === d || b === c || b === d) continue;
      const pc = points[c]!;
      const pd = points[d]!;
      const intersection = segmentIntersectionParameters(pa, pb, pc, pd);
      if (intersection && intersection.t > EPSILON && intersection.t < 1 - EPSILON && intersection.u > EPSILON && intersection.u < 1 - EPSILON) {
        throw new GeometryEditError("edge-crossing-after-move", "Moving the vertex would create an unregistered edge crossing.");
      }
      if (
        pointOnSegment(pa, pc, pd) || pointOnSegment(pb, pc, pd) ||
        pointOnSegment(pc, pa, pb) || pointOnSegment(pd, pa, pb)
      ) {
        throw new GeometryEditError("edge-overlap-after-move", "Moving the vertex would create an overlapping or touching unrelated edge.");
      }
    }
  }
}

function normalizeAngle(value: number): number {
  let angle = value;
  while (angle <= -180) angle += 360;
  while (angle > 180) angle -= 360;
  return Math.abs(angle + 180) < 1e-9 ? 180 : angle;
}

function circularAngleDistance(a: number, b: number): number {
  const delta = Math.abs(normalizeAngle(a - b));
  return Math.min(delta, 360 - delta);
}

function distanceSquared(a: Vec2, b: Vec2): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}
