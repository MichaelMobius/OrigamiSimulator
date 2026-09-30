import type { NormalizedFoldGraph } from "../../../packages/core/src/fold/types.ts";
import { GeometryEditError } from "./geometryEditor.ts";

const DERIVED_TOPOLOGY_KEYS = [
  "edges_faces",
  "faces_edges",
  "faces_faces",
  "vertices_edges",
  "vertices_faces",
  "vertices_vertices",
] as const;

const ORDER_METADATA_KEYS = ["faceOrders", "edgeOrders"] as const;

export interface SplitEdgeResult {
  graph: NormalizedFoldGraph;
  vertexIndex: number;
  firstEdgeIndex: number;
  secondEdgeIndex: number;
  droppedOrderMetadata: boolean;
}

export function splitEdgeAt(
  graph: NormalizedFoldGraph,
  edgeIndex: number,
  parameter = 0.5,
): SplitEdgeResult {
  if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= graph.edges_vertices.length) {
    throw new GeometryEditError("invalid-edge", "Select a valid edge to split.");
  }
  if (!Number.isFinite(parameter) || parameter <= 1e-4 || parameter >= 1 - 1e-4) {
    throw new GeometryEditError(
      "split-too-close-to-vertex",
      "Place the new vertex away from the existing edge endpoints.",
    );
  }

  const edge = graph.edges_vertices[edgeIndex]!;
  const [a, b] = edge;
  const vertices = graph.vertices_coords ?? [];
  const vertexA = vertices[a];
  const vertexB = vertices[b];
  if (!vertexA || !vertexB) {
    throw new GeometryEditError("invalid-edge", "The selected edge references a missing vertex.");
  }

  const incidentFaces = (graph.faces_vertices ?? [])
    .map((face, index) => ({ face, index, positions: boundaryPositions(face, a, b) }))
    .filter(({ positions }) => positions.length > 0);

  if (incidentFaces.length < 1 || incidentFaces.length > 2) {
    throw new GeometryEditError(
      "invalid-edge-incidence",
      "An editable edge must bound one or two faces before it can be split.",
    );
  }
  if (incidentFaces.some(({ positions }) => positions.length !== 1)) {
    throw new GeometryEditError(
      "invalid-face-boundary",
      "The selected edge appears more than once in a face boundary.",
    );
  }

  const next = structuredClone(graph) as NormalizedFoldGraph;
  const oldVertexCount = vertices.length;
  const oldEdgeCount = graph.edges_vertices.length;
  const vertexIndex = oldVertexCount;
  const assignment = next.edges_assignment[edgeIndex] ?? "U";
  const foldAngle = next.edges_foldAngle[edgeIndex] ?? 0;
  const newVertex = interpolateVertex(vertexA, vertexB, parameter);
  const droppedOrderMetadata = ORDER_METADATA_KEYS.some((key) => next[key] !== undefined);

  next.vertices_coords = [...(next.vertices_coords ?? []), newVertex];
  alignUnknownVertexArrays(next, oldVertexCount);

  next.edges_vertices.splice(edgeIndex, 1, [a, vertexIndex], [vertexIndex, b]);
  next.edges_assignment.splice(edgeIndex, 1, assignment, assignment);
  next.edges_foldAngle.splice(edgeIndex, 1, foldAngle, foldAngle);
  duplicateUnknownEdgeMetadata(next, oldEdgeCount, edgeIndex);

  const nextFaces = (next.faces_vertices ?? []).map((face) => [...face]);
  for (const { index, positions } of incidentFaces) {
    const insertAfter = positions[0]!;
    const face = nextFaces[index]!;
    if (insertAfter === face.length - 1) face.push(vertexIndex);
    else face.splice(insertAfter + 1, 0, vertexIndex);
  }
  next.faces_vertices = nextFaces;

  clearDerivedConnectivity(next);
  for (const key of ORDER_METADATA_KEYS) delete next[key];

  return {
    graph: next,
    vertexIndex,
    firstEdgeIndex: edgeIndex,
    secondEdgeIndex: edgeIndex + 1,
    droppedOrderMetadata,
  };
}

function boundaryPositions(face: number[], a: number, b: number): number[] {
  const positions: number[] = [];
  for (let index = 0; index < face.length; index += 1) {
    const current = face[index]!;
    const next = face[(index + 1) % face.length]!;
    if ((current === a && next === b) || (current === b && next === a)) positions.push(index);
  }
  return positions;
}

function interpolateVertex(
  a: readonly number[],
  b: readonly number[],
  parameter: number,
): number[] {
  const dimensions = Math.max(a.length, b.length, 2);
  const result: number[] = [];
  for (let axis = 0; axis < dimensions; axis += 1) {
    const av = a[axis] ?? 0;
    const bv = b[axis] ?? 0;
    result.push(av + (bv - av) * parameter);
  }
  return result;
}

function duplicateUnknownEdgeMetadata(
  graph: NormalizedFoldGraph,
  oldCount: number,
  edgeIndex: number,
): void {
  for (const [key, value] of Object.entries(graph)) {
    if (
      !key.startsWith("edges_") ||
      ["edges_vertices", "edges_assignment", "edges_foldAngle"].includes(key) ||
      !Array.isArray(value) ||
      value.length !== oldCount
    ) {
      continue;
    }
    const original = structuredClone(value[edgeIndex]);
    value.splice(edgeIndex, 1, original, structuredClone(original));
  }
}

function alignUnknownVertexArrays(graph: NormalizedFoldGraph, oldCount: number): void {
  for (const [key, value] of Object.entries(graph)) {
    if (
      key === "vertices_coords" ||
      !key.startsWith("vertices_") ||
      !Array.isArray(value) ||
      value.length !== oldCount
    ) {
      continue;
    }
    value.push(null);
  }
}

function clearDerivedConnectivity(graph: NormalizedFoldGraph): void {
  for (const key of DERIVED_TOPOLOGY_KEYS) delete graph[key];
}
