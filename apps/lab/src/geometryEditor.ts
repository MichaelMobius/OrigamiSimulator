import {
  faceSignedArea,
  isSimpleFace,
  isValidFaceDiagonal,
} from "../../../packages/core/src/geometry/planar.ts";
import type {
  EdgeAssignment,
  NormalizedFoldGraph,
} from "../../../packages/core/src/fold/types.ts";

const DERIVED_TOPOLOGY_KEYS = [
  "edges_faces",
  "faces_edges",
  "faces_faces",
  "vertices_edges",
  "vertices_faces",
  "vertices_vertices",
] as const;

const ORDER_METADATA_KEYS = ["faceOrders", "edgeOrders"] as const;

export class GeometryEditError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "GeometryEditError";
  }
}

export interface AddCreaseResult {
  graph: NormalizedFoldGraph;
  edgeIndex: number;
  splitFaceIndex: number;
  droppedOrderMetadata: boolean;
}

export interface DeleteCreaseResult {
  graph: NormalizedFoldGraph;
  mergedFaceIndex: number;
  droppedOrderMetadata: boolean;
}

export function addCreaseBetweenVertices(
  graph: NormalizedFoldGraph,
  vertexA: number,
  vertexB: number,
  assignment: EdgeAssignment = "V",
  foldAngle = defaultFoldAngle(assignment),
): AddCreaseResult {
  assertVertex(graph, vertexA);
  assertVertex(graph, vertexB);

  if (vertexA === vertexB) {
    throw new GeometryEditError("same-vertex", "A crease needs two different vertices.");
  }

  if (graph.edges_vertices.some(([a, b]) => sameUndirectedEdge(a, b, vertexA, vertexB))) {
    throw new GeometryEditError("edge-exists", "Those vertices are already connected by an edge.");
  }

  const faces = graph.faces_vertices ?? [];
  const candidates = faces
    .map((face, index) => ({ face, index }))
    .filter(({ face }) => face.includes(vertexA) && face.includes(vertexB));

  if (candidates.length === 0) {
    throw new GeometryEditError("no-common-face", "The two vertices must belong to the same face.");
  }
  if (candidates.length > 1) {
    throw new GeometryEditError(
      "ambiguous-face",
      "The vertices share more than one face; this edit is ambiguous.",
    );
  }

  const candidate = candidates[0]!;
  const vertices = graph.vertices_coords ?? [];
  if (!isSimpleFace(candidate.face, vertices)) {
    throw new GeometryEditError("invalid-face", "The containing face is not a simple polygon.");
  }
  if (!isValidFaceDiagonal(candidate.face, vertices, vertexA, vertexB)) {
    throw new GeometryEditError(
      "crease-outside-face",
      "That segment is not a valid interior diagonal of the selected face.",
    );
  }

  const aIndex = candidate.face.indexOf(vertexA);
  const bIndex = candidate.face.indexOf(vertexB);
  const pathAB = walkFace(candidate.face, aIndex, bIndex);
  const pathBA = walkFace(candidate.face, bIndex, aIndex);

  if (
    pathAB.length < 3 ||
    pathBA.length < 3 ||
    !isSimpleFace(pathAB, vertices) ||
    !isSimpleFace(pathBA, vertices) ||
    Math.abs(faceSignedArea(pathAB, vertices)) <= 1e-9 ||
    Math.abs(faceSignedArea(pathBA, vertices)) <= 1e-9
  ) {
    throw new GeometryEditError("invalid-face-split", "The crease would create a degenerate or self-intersecting face.");
  }

  const next = cloneGraph(graph);
  const droppedOrderMetadata = hasOrderMetadata(next);
  const oldEdgeCount = next.edges_vertices.length;
  next.edges_vertices.push([vertexA, vertexB]);
  next.edges_assignment.push(assignment);
  next.edges_foldAngle.push(foldAngle);
  alignUnknownEdgeArrays(next, oldEdgeCount, "add", oldEdgeCount);

  const nextFaces = (next.faces_vertices ?? []).map((face) => [...face]);
  nextFaces.splice(candidate.index, 1, pathAB, pathBA);
  next.faces_vertices = nextFaces;
  clearDerivedTopology(next);

  return {
    graph: next,
    edgeIndex: oldEdgeCount,
    splitFaceIndex: candidate.index,
    droppedOrderMetadata,
  };
}

export function deleteInternalCrease(
  graph: NormalizedFoldGraph,
  edgeIndex: number,
): DeleteCreaseResult {
  if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= graph.edges_vertices.length) {
    throw new GeometryEditError("invalid-edge", "Select a valid edge to delete.");
  }

  const edge = graph.edges_vertices[edgeIndex]!;
  const [a, b] = edge;
  const faces = graph.faces_vertices ?? [];
  const incident = faces
    .map((face, index) => ({ face, index }))
    .filter(({ face }) => containsBoundaryEdge(face, a, b));

  if (incident.length !== 2) {
    throw new GeometryEditError(
      "not-internal-edge",
      "Only an internal edge shared by exactly two faces can be removed.",
    );
  }

  const first = incident[0]!;
  const second = incident[1]!;
  const pathAB = nonEdgePath(first.face, a, b);
  const pathBA = nonEdgePath(second.face, b, a);
  const merged = [...pathAB, ...pathBA.slice(1, -1)];
  const vertices = graph.vertices_coords ?? [];

  if (
    merged.length < 3 ||
    new Set(merged).size !== merged.length ||
    !isSimpleFace(merged, vertices) ||
    Math.abs(faceSignedArea(merged, vertices)) <= 1e-9
  ) {
    throw new GeometryEditError(
      "invalid-face-merge",
      "Removing this edge would create a degenerate or self-intersecting face.",
    );
  }

  const next = cloneGraph(graph);
  const droppedOrderMetadata = hasOrderMetadata(next);
  const oldEdgeCount = next.edges_vertices.length;
  next.edges_vertices.splice(edgeIndex, 1);
  next.edges_assignment.splice(edgeIndex, 1);
  next.edges_foldAngle.splice(edgeIndex, 1);
  alignUnknownEdgeArrays(next, oldEdgeCount, "delete", edgeIndex);

  const low = Math.min(first.index, second.index);
  const high = Math.max(first.index, second.index);
  const nextFaces = (next.faces_vertices ?? []).map((face) => [...face]);
  nextFaces[low] = merged;
  nextFaces.splice(high, 1);
  next.faces_vertices = nextFaces;
  clearDerivedTopology(next);

  return { graph: next, mergedFaceIndex: low, droppedOrderMetadata };
}

export class GraphHistory {
  private undoStack: Array<{ graph: NormalizedFoldGraph; label: string }> = [];
  private redoStack: Array<{ graph: NormalizedFoldGraph; label: string }> = [];
  private readonly limit: number;

  constructor(limit = 100) {
    this.limit = limit;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  record(previous: NormalizedFoldGraph, label: string): void {
    this.undoStack.push({ graph: cloneGraph(previous), label });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(current: NormalizedFoldGraph): { graph: NormalizedFoldGraph; label: string } | undefined {
    const entry = this.undoStack.pop();
    if (!entry) return undefined;
    this.redoStack.push({ graph: cloneGraph(current), label: entry.label });
    return { graph: cloneGraph(entry.graph), label: entry.label };
  }

  redo(current: NormalizedFoldGraph): { graph: NormalizedFoldGraph; label: string } | undefined {
    const entry = this.redoStack.pop();
    if (!entry) return undefined;
    this.undoStack.push({ graph: cloneGraph(current), label: entry.label });
    return { graph: cloneGraph(entry.graph), label: entry.label };
  }
}

function defaultFoldAngle(assignment: EdgeAssignment): number {
  if (assignment === "V") return 180;
  if (assignment === "M") return -180;
  return 0;
}

function assertVertex(graph: NormalizedFoldGraph, index: number): void {
  const count = graph.vertices_coords?.length ?? 0;
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new GeometryEditError("invalid-vertex", `Vertex ${index} does not exist.`);
  }
}

function sameUndirectedEdge(a: number, b: number, c: number, d: number): boolean {
  return (a === c && b === d) || (a === d && b === c);
}

function containsBoundaryEdge(face: number[], a: number, b: number): boolean {
  return face.some((vertex, index) =>
    sameUndirectedEdge(vertex, face[(index + 1) % face.length]!, a, b),
  );
}

function walkFace(face: number[], startIndex: number, endIndex: number): number[] {
  const result: number[] = [];
  let index = startIndex;
  for (let guard = 0; guard <= face.length; guard += 1) {
    result.push(face[index]!);
    if (index === endIndex) return result;
    index = (index + 1) % face.length;
  }
  throw new GeometryEditError("invalid-face", "Unable to walk face cycle.");
}

function nonEdgePath(face: number[], startVertex: number, endVertex: number): number[] {
  const start = face.indexOf(startVertex);
  const end = face.indexOf(endVertex);
  if (start < 0 || end < 0) {
    throw new GeometryEditError("invalid-face", "Shared edge vertices are missing from a face.");
  }

  const forward = walkFace(face, start, end);
  const backward = [...walkFace(face, end, start)].reverse();
  const candidates = [forward, backward].filter((path) => path.length > 2);
  if (candidates.length !== 1) {
    throw new GeometryEditError(
      "invalid-face-boundary",
      "The selected edge is not a simple boundary of both incident faces.",
    );
  }
  return candidates[0]!;
}

function cloneGraph(graph: NormalizedFoldGraph): NormalizedFoldGraph {
  return structuredClone(graph) as NormalizedFoldGraph;
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

function alignUnknownEdgeArrays(
  graph: NormalizedFoldGraph,
  oldCount: number,
  mode: "add" | "delete",
  index: number,
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
    if (mode === "add") value.push(null);
    else value.splice(index, 1);
  }
}
