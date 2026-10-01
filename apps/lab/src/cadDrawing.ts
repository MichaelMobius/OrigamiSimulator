import {
  chooseProjectionAxes,
  isValidFaceDiagonal,
  pointInPolygon,
  pointOnSegment,
  projectVertices2D,
  segmentIntersectionParameters,
  type Vec2,
} from "../../../packages/core/src/geometry/planar.ts";
import type {
  EdgeAssignment,
  NormalizedFoldGraph,
} from "../../../packages/core/src/fold/types.ts";
import { addCreaseBetweenVertices, GeometryEditError } from "./geometryEditor.ts";
import { splitEdgeAt } from "./edgeSplit.ts";

const DERIVED_TOPOLOGY_KEYS = [
  "edges_faces",
  "faces_edges",
  "faces_faces",
  "vertices_edges",
  "vertices_faces",
  "vertices_vertices",
] as const;
const ORDER_METADATA_KEYS = ["faceOrders", "edgeOrders"] as const;
const EPSILON = 1e-7;

export interface InsertInteriorVertexResult {
  graph: NormalizedFoldGraph;
  vertexIndex: number;
  droppedOrderMetadata: boolean;
}

export interface TraceCreaseResult {
  graph: NormalizedFoldGraph;
  edgeIndices: number[];
  intersectionVertices: number[];
  droppedOrderMetadata: boolean;
}

export type SnapResult =
  | { kind: "vertex"; point: Vec2; vertexIndex: number }
  | { kind: "edge"; point: Vec2; edgeIndex: number; parameter: number }
  | { kind: "grid" | "free"; point: Vec2 };

export function snapPointToGraph(
  graph: NormalizedFoldGraph,
  rawPoint: Vec2,
  options: { tolerance: number; gridSize?: number; gridEnabled?: boolean },
): SnapResult {
  const points = projectVertices2D(graph.vertices_coords ?? []);
  const toleranceSquared = options.tolerance * options.tolerance;
  let nearestVertex = -1;
  let nearestVertexDistance = Number.POSITIVE_INFINITY;

  points.forEach((point, index) => {
    const distance = squaredDistance(rawPoint, point);
    if (distance < nearestVertexDistance) {
      nearestVertex = index;
      nearestVertexDistance = distance;
    }
  });
  if (nearestVertex >= 0 && nearestVertexDistance <= toleranceSquared) {
    return { kind: "vertex", point: points[nearestVertex]!, vertexIndex: nearestVertex };
  }

  let nearestEdge = -1;
  let nearestParameter = 0;
  let nearestPoint: Vec2 = rawPoint;
  let nearestEdgeDistance = Number.POSITIVE_INFINITY;
  graph.edges_vertices.forEach(([aIndex, bIndex], edgeIndex) => {
    const a = points[aIndex];
    const b = points[bIndex];
    if (!a || !b) return;
    const projection = projectToSegment(rawPoint, a, b);
    const distance = squaredDistance(rawPoint, projection.point);
    if (distance < nearestEdgeDistance) {
      nearestEdge = edgeIndex;
      nearestParameter = projection.parameter;
      nearestPoint = projection.point;
      nearestEdgeDistance = distance;
    }
  });
  if (nearestEdge >= 0 && nearestEdgeDistance <= toleranceSquared) {
    const edge = graph.edges_vertices[nearestEdge]!;
    if (nearestParameter <= 1e-4) {
      return { kind: "vertex", point: points[edge[0]]!, vertexIndex: edge[0] };
    }
    if (nearestParameter >= 1 - 1e-4) {
      return { kind: "vertex", point: points[edge[1]]!, vertexIndex: edge[1] };
    }
    return { kind: "edge", point: nearestPoint, edgeIndex: nearestEdge, parameter: nearestParameter };
  }

  if (options.gridEnabled && options.gridSize && Number.isFinite(options.gridSize) && options.gridSize > 0) {
    const gridPoint: Vec2 = [
      Math.round(rawPoint[0] / options.gridSize) * options.gridSize,
      Math.round(rawPoint[1] / options.gridSize) * options.gridSize,
    ];
    return { kind: "grid", point: gridPoint };
  }
  return { kind: "free", point: rawPoint };
}

export function findContainingFace(graph: NormalizedFoldGraph, point: Vec2): number {
  const points = projectVertices2D(graph.vertices_coords ?? []);
  const matches = (graph.faces_vertices ?? [])
    .map((face, index) => ({ face, index }))
    .filter(({ face }) => {
      const polygon = face.map((vertex) => points[vertex]).filter((vertex): vertex is Vec2 => vertex !== undefined);
      return polygon.length === face.length && pointInPolygon(point, polygon);
    });

  if (matches.length === 1) return matches[0]!.index;
  if (matches.length === 0) {
    throw new GeometryEditError("point-outside-paper", "Place the point inside the paper boundary.");
  }
  throw new GeometryEditError("point-on-topology", "That point lies on existing topology; snap to the nearby edge or vertex instead.");
}

export function insertInteriorVertex(
  graph: NormalizedFoldGraph,
  faceIndex: number,
  point: Vec2,
): InsertInteriorVertexResult {
  const faces = graph.faces_vertices ?? [];
  const face = faces[faceIndex];
  if (!face || face.length < 3) {
    throw new GeometryEditError("invalid-face", "Select a valid face before inserting a point.");
  }

  const vertices = graph.vertices_coords ?? [];
  const projected = projectVertices2D(vertices);
  const polygon = face.map((index) => projected[index]).filter((vertex): vertex is Vec2 => vertex !== undefined);
  if (polygon.length !== face.length || !pointInPolygon(point, polygon)) {
    throw new GeometryEditError("point-outside-face", "The new point must lie inside the selected face.");
  }
  if (polygon.some((vertex, index) => pointOnSegment(point, vertex, polygon[(index + 1) % polygon.length]!))) {
    throw new GeometryEditError("point-on-edge", "Use edge snapping when placing a point on an existing edge.");
  }

  const next = structuredClone(graph) as NormalizedFoldGraph;
  const droppedOrderMetadata = hasOrderMetadata(next);
  const oldVertexCount = vertices.length;
  const oldEdgeCount = next.edges_vertices.length;
  const vertexIndex = oldVertexCount;
  next.vertices_coords = [...vertices.map((vertex) => [...vertex]), liftPoint(point, vertices)];
  alignUnknownVertexArrays(next, oldVertexCount);

  const auxiliary = ensureAuxiliaryArray(next, oldEdgeCount);
  const unknownEdgeArrays = edgeMetadataArrays(next, oldEdgeCount);
  for (const boundaryVertex of face) {
    next.edges_vertices.push([vertexIndex, boundaryVertex]);
    next.edges_assignment.push("F");
    next.edges_foldAngle.push(0);
    auxiliary.push(true);
    for (const array of unknownEdgeArrays) array.push(null);
  }

  const triangles = face.map((vertex, index) => [
    vertex,
    face[(index + 1) % face.length]!,
    vertexIndex,
  ]);
  const nextFaces = faces.map((item) => [...item]);
  nextFaces.splice(faceIndex, 1, ...triangles);
  next.faces_vertices = nextFaces;
  clearDerivedTopology(next);

  return { graph: next, vertexIndex, droppedOrderMetadata };
}

export function traceCreaseBetweenVertices(
  graph: NormalizedFoldGraph,
  startVertex: number,
  endVertex: number,
  assignment: EdgeAssignment = "V",
  foldAngle = defaultFoldAngle(assignment),
): TraceCreaseResult {
  if (startVertex === endVertex) {
    throw new GeometryEditError("same-vertex", "A crease needs two different endpoints.");
  }
  assertVertex(graph, startVertex);
  assertVertex(graph, endVertex);

  let next = structuredClone(graph) as NormalizedFoldGraph;
  let current = startVertex;
  const edgeIndices: number[] = [];
  const intersectionVertices: number[] = [];
  let droppedOrderMetadata = false;

  for (let guard = 0; guard < 2048; guard += 1) {
    if (current === endVertex) {
      return { graph: next, edgeIndices, intersectionVertices, droppedOrderMetadata };
    }

    const existing = findEdgeIndex(next, current, endVertex);
    if (existing >= 0) {
      next = assignExistingEdge(next, existing, assignment, foldAngle);
      edgeIndices.push(existing);
      return { graph: next, edgeIndices, intersectionVertices, droppedOrderMetadata };
    }

    const vertices = next.vertices_coords ?? [];
    const points = projectVertices2D(vertices);
    const currentPoint = points[current]!;
    const endPoint = points[endVertex]!;
    const dx = endPoint[0] - currentPoint[0];
    const dy = endPoint[1] - currentPoint[1];
    const remainingLength = Math.hypot(dx, dy);
    if (remainingLength <= EPSILON) {
      throw new GeometryEditError("coincident-vertices", "The crease endpoints occupy the same position.");
    }
    const probeScale = Math.min(1e-5, Math.max(1e-8, 1e-4 / remainingLength));
    const probe: Vec2 = [currentPoint[0] + dx * probeScale, currentPoint[1] + dy * probeScale];

    const incidentFaces = (next.faces_vertices ?? [])
      .map((face, index) => ({ face, index }))
      .filter(({ face }) => face.includes(current))
      .filter(({ face }) => {
        const polygon = face.map((vertex) => points[vertex]).filter((vertex): vertex is Vec2 => vertex !== undefined);
        return polygon.length === face.length && pointInPolygon(probe, polygon);
      });

    if (incidentFaces.length === 0) {
      throw new GeometryEditError("crease-path-lost", "Unable to determine which face the crease enters next.");
    }

    const direct = incidentFaces.find(({ face }) =>
      face.includes(endVertex) && isValidFaceDiagonal(face, vertices, current, endVertex),
    );
    if (direct) {
      const result = addCreaseBetweenVertices(next, current, endVertex, assignment, foldAngle);
      next = result.graph;
      markEdgeNonAuxiliary(next, result.edgeIndex);
      edgeIndices.push(result.edgeIndex);
      droppedOrderMetadata ||= result.droppedOrderMetadata;
      return { graph: next, edgeIndices, intersectionVertices, droppedOrderMetadata };
    }

    const crossingCandidates = incidentFaces
      .map(({ face, index }) => ({ faceIndex: index, crossing: firstBoundaryCrossing(next, face, currentPoint, endPoint, current) }))
      .filter((entry): entry is { faceIndex: number; crossing: BoundaryCrossing } => entry.crossing !== undefined)
      .sort((a, b) => a.crossing.t - b.crossing.t);

    const crossing = crossingCandidates[0]?.crossing;
    if (!crossing) {
      throw new GeometryEditError("crease-path-blocked", "The crease cannot continue through the current face without leaving the paper.");
    }

    let intersectionVertex: number;
    if (crossing.u <= EPSILON) {
      intersectionVertex = crossing.edgeVertices[0];
    } else if (crossing.u >= 1 - EPSILON) {
      intersectionVertex = crossing.edgeVertices[1];
    } else {
      const split = splitEdgeAt(next, crossing.edgeIndex, crossing.u);
      next = split.graph;
      intersectionVertex = split.vertexIndex;
      intersectionVertices.push(intersectionVertex);
      droppedOrderMetadata ||= split.droppedOrderMetadata;
    }

    if (intersectionVertex === current) {
      throw new GeometryEditError("crease-path-stalled", "The crease path stalled at an existing vertex.");
    }

    const connection = connectWithinFace(next, current, intersectionVertex, assignment, foldAngle);
    next = connection.graph;
    edgeIndices.push(connection.edgeIndex);
    droppedOrderMetadata ||= connection.droppedOrderMetadata;
    current = intersectionVertex;
  }

  throw new GeometryEditError("crease-path-overflow", "The crease crossed too many faces to complete safely.");
}

interface BoundaryCrossing {
  edgeIndex: number;
  edgeVertices: readonly [number, number];
  t: number;
  u: number;
}

function firstBoundaryCrossing(
  graph: NormalizedFoldGraph,
  face: readonly number[],
  start: Vec2,
  end: Vec2,
  currentVertex: number,
): BoundaryCrossing | undefined {
  const points = projectVertices2D(graph.vertices_coords ?? []);
  const candidates: BoundaryCrossing[] = [];
  for (let index = 0; index < face.length; index += 1) {
    const aIndex = face[index]!;
    const bIndex = face[(index + 1) % face.length]!;
    const a = points[aIndex];
    const b = points[bIndex];
    if (!a || !b) continue;
    const intersection = segmentIntersectionParameters(start, end, a, b);
    if (!intersection || intersection.t <= EPSILON || intersection.t >= 1 - EPSILON) continue;
    if ((aIndex === currentVertex || bIndex === currentVertex) && intersection.t < 1e-5) continue;
    const edgeIndex = findEdgeIndex(graph, aIndex, bIndex);
    if (edgeIndex < 0) continue;
    candidates.push({
      edgeIndex,
      edgeVertices: [aIndex, bIndex],
      t: intersection.t,
      u: intersection.u,
    });
  }
  candidates.sort((a, b) => a.t - b.t);
  return candidates[0];
}

function connectWithinFace(
  graph: NormalizedFoldGraph,
  a: number,
  b: number,
  assignment: EdgeAssignment,
  foldAngle: number,
): { graph: NormalizedFoldGraph; edgeIndex: number; droppedOrderMetadata: boolean } {
  const existing = findEdgeIndex(graph, a, b);
  if (existing >= 0) {
    return {
      graph: assignExistingEdge(graph, existing, assignment, foldAngle),
      edgeIndex: existing,
      droppedOrderMetadata: false,
    };
  }
  const result = addCreaseBetweenVertices(graph, a, b, assignment, foldAngle);
  markEdgeNonAuxiliary(result.graph, result.edgeIndex);
  return { graph: result.graph, edgeIndex: result.edgeIndex, droppedOrderMetadata: result.droppedOrderMetadata };
}

function assignExistingEdge(
  graph: NormalizedFoldGraph,
  edgeIndex: number,
  assignment: EdgeAssignment,
  foldAngle: number,
): NormalizedFoldGraph {
  const current = graph.edges_assignment[edgeIndex] ?? "U";
  if (current === "B" || current === "C" || current === "J") {
    throw new GeometryEditError("protected-edge", "A crease cannot overwrite a boundary, cut, or join edge.");
  }
  const next = structuredClone(graph) as NormalizedFoldGraph;
  next.edges_assignment[edgeIndex] = assignment;
  next.edges_foldAngle[edgeIndex] = foldAngle;
  markEdgeNonAuxiliary(next, edgeIndex);
  return next;
}

function markEdgeNonAuxiliary(graph: NormalizedFoldGraph, edgeIndex: number): void {
  const value = graph.edges_origamiLabAuxiliary;
  if (Array.isArray(value) && edgeIndex >= 0 && edgeIndex < value.length) value[edgeIndex] = false;
}

function findEdgeIndex(graph: NormalizedFoldGraph, a: number, b: number): number {
  return graph.edges_vertices.findIndex(([c, d]) => (a === c && b === d) || (a === d && b === c));
}

function assertVertex(graph: NormalizedFoldGraph, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= (graph.vertices_coords?.length ?? 0)) {
    throw new GeometryEditError("invalid-vertex", `Vertex ${index} does not exist.`);
  }
}

function defaultFoldAngle(assignment: EdgeAssignment): number {
  if (assignment === "M") return -180;
  if (assignment === "V") return 180;
  return 0;
}

function projectToSegment(point: Vec2, a: Vec2, b: Vec2): { point: Vec2; parameter: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) return { point: a, parameter: 0 };
  const raw = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared;
  const parameter = Math.max(0, Math.min(1, raw));
  return { point: [a[0] + parameter * dx, a[1] + parameter * dy], parameter };
}

function squaredDistance(a: Vec2, b: Vec2): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function liftPoint(point: Vec2, vertices: readonly (readonly number[])[]): number[] {
  const dimensions = Math.max(2, ...vertices.map((vertex) => vertex.length));
  if (dimensions <= 2) return [point[0], point[1]];
  const axes = chooseProjectionAxes(vertices);
  const result = Array.from({ length: dimensions }, (_, axis) => {
    const values = vertices.map((vertex) => Number(vertex[axis] ?? 0));
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  });
  result[axes[0]] = point[0];
  result[axes[1]] = point[1];
  return result;
}

function ensureAuxiliaryArray(graph: NormalizedFoldGraph, edgeCount: number): boolean[] {
  const existing = graph.edges_origamiLabAuxiliary;
  if (Array.isArray(existing) && existing.length === edgeCount) return existing as boolean[];
  const auxiliary = Array(edgeCount).fill(false) as boolean[];
  graph.edges_origamiLabAuxiliary = auxiliary;
  return auxiliary;
}

function edgeMetadataArrays(graph: NormalizedFoldGraph, oldCount: number): unknown[][] {
  return Object.entries(graph)
    .filter(([key, value]) =>
      key.startsWith("edges_") &&
      !["edges_vertices", "edges_assignment", "edges_foldAngle", "edges_origamiLabAuxiliary"].includes(key) &&
      Array.isArray(value) &&
      value.length === oldCount,
    )
    .map(([, value]) => value as unknown[]);
}

function alignUnknownVertexArrays(graph: NormalizedFoldGraph, oldCount: number): void {
  for (const [key, value] of Object.entries(graph)) {
    if (
      key === "vertices_coords" ||
      !key.startsWith("vertices_") ||
      !Array.isArray(value) ||
      value.length !== oldCount
    ) continue;
    value.push(null);
  }
}

function hasOrderMetadata(graph: NormalizedFoldGraph): boolean {
  return ORDER_METADATA_KEYS.some((key) => graph[key] !== undefined);
}

function clearDerivedTopology(graph: NormalizedFoldGraph): void {
  for (const key of DERIVED_TOPOLOGY_KEYS) delete graph[key];
  for (const key of ORDER_METADATA_KEYS) delete graph[key];
  for (const key of Object.keys(graph)) {
    if (key.startsWith("faces_") && key !== "faces_vertices") delete graph[key];
  }
}
