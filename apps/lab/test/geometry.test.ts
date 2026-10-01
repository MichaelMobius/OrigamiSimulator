import test from "node:test";
import assert from "node:assert/strict";
import {
  findContainingFace,
  insertInteriorVertex,
  snapPointToGraph,
  traceCreaseBetweenVertices,
} from "../src/cadDrawing.ts";
import {
  addCreaseBetweenVertices,
  deleteInternalCrease,
  GeometryEditError,
  GraphHistory,
} from "../src/geometryEditor.ts";
import { splitEdgeAt } from "../src/edgeSplit.ts";

function fixture() {
  return {
    vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1]],
    edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]],
    edges_assignment: ["B", "B", "B", "B", "V"],
    edges_foldAngle: [0, 0, 0, 0, 90],
    faces_vertices: [[0, 1, 2], [0, 2, 3]],
  };
}

function blankSquare() {
  return {
    file_spec: 1.1,
    file_units: "mm",
    vertices_coords: [[0, 0], [10, 0], [10, 10], [0, 10]],
    edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0]],
    edges_assignment: ["B", "B", "B", "B"],
    edges_foldAngle: [0, 0, 0, 0],
    faces_vertices: [[0, 1, 2, 3]],
  };
}

test("deleting an internal crease merges two faces and adding it back splits them", () => {
  const deleted = deleteInternalCrease(fixture(), 4).graph;
  assert.equal(deleted.edges_vertices.length, 4);
  assert.deepEqual(deleted.faces_vertices, [[0, 1, 2, 3]]);

  const added = addCreaseBetweenVertices(deleted, 0, 2, "V", 90);
  assert.equal(added.edgeIndex, 4);
  assert.equal(added.graph.faces_vertices?.length, 2);
  assert.deepEqual(added.graph.edges_vertices[4], [0, 2]);
});

test("duplicate creases are rejected", () => {
  assert.throws(
    () => addCreaseBetweenVertices(fixture(), 0, 2),
    (error) => error instanceof GeometryEditError && error.code === "edge-exists",
  );
});

test("boundary edges cannot be deleted", () => {
  assert.throws(
    () => deleteInternalCrease(fixture(), 0),
    (error) => error instanceof GeometryEditError && error.code === "not-internal-edge",
  );
});

test("history restores geometry in both directions", () => {
  const history = new GraphHistory();
  const original = fixture();
  const edited = deleteInternalCrease(original, 4).graph;
  history.record(original, "Delete crease");

  const undone = history.undo(edited);
  assert.equal(undone?.graph.edges_vertices.length, 5);
  assert.equal(history.canRedo, true);

  const redone = history.redo(undone!.graph);
  assert.equal(redone?.graph.edges_vertices.length, 4);
});

test("concave diagonals that leave the face are rejected", () => {
  const graph = {
    vertices_coords: [[0, 0], [3, 0], [3, 3], [1.5, 1], [0, 3]],
    edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]],
    edges_assignment: ["B", "B", "B", "B", "B"],
    edges_foldAngle: [0, 0, 0, 0, 0],
    faces_vertices: [[0, 1, 2, 3, 4]],
  };
  assert.throws(
    () => addCreaseBetweenVertices(graph, 2, 4),
    (error) => error instanceof GeometryEditError && error.code === "crease-outside-face",
  );
});

test("topology edits remove stale faceOrders and edgeOrders", () => {
  const graph = {
    ...fixture(),
    faceOrders: [[0, 1, 1]],
    edgeOrders: [[0, 4, 1]],
  };
  const result = deleteInternalCrease(graph, 4);
  assert.equal(result.droppedOrderMetadata, true);
  assert.equal(result.graph.faceOrders, undefined);
  assert.equal(result.graph.edgeOrders, undefined);
});

test("splitting a boundary edge inserts a vertex into the incident face", () => {
  const result = splitEdgeAt(fixture(), 0, 0.25);
  assert.equal(result.vertexIndex, 4);
  assert.equal(result.graph.vertices_coords?.length, 5);
  assert.deepEqual(result.graph.vertices_coords?.[4], [0.25, 0]);
  assert.deepEqual(result.graph.edges_vertices[0], [0, 4]);
  assert.deepEqual(result.graph.edges_vertices[1], [4, 1]);
  assert.deepEqual(result.graph.faces_vertices?.[0], [0, 4, 1, 2]);
  assert.equal(result.graph.edges_assignment[0], "B");
  assert.equal(result.graph.edges_assignment[1], "B");
});

test("splitting an internal crease preserves its assignment and updates both faces", () => {
  const graph = {
    ...fixture(),
    edges_custom: ["e0", "e1", "e2", "e3", "hinge"],
    vertices_custom: ["v0", "v1", "v2", "v3"],
    faceOrders: [[0, 1, 1]],
  };
  const result = splitEdgeAt(graph, 4, 0.5);
  assert.equal(result.graph.edges_vertices.length, 6);
  assert.deepEqual(result.graph.edges_vertices[4], [0, 4]);
  assert.deepEqual(result.graph.edges_vertices[5], [4, 2]);
  assert.deepEqual(result.graph.edges_assignment.slice(4, 6), ["V", "V"]);
  assert.deepEqual(result.graph.edges_foldAngle.slice(4, 6), [90, 90]);
  assert.deepEqual(result.graph.faces_vertices, [[0, 1, 2, 4], [0, 4, 2, 3]]);
  assert.deepEqual(result.graph.edges_custom, ["e0", "e1", "e2", "e3", "hinge", "hinge"]);
  assert.deepEqual(result.graph.vertices_custom, ["v0", "v1", "v2", "v3", null]);
  assert.equal(result.droppedOrderMetadata, true);
  assert.equal(result.graph.faceOrders, undefined);
});

test("edge splits too close to an endpoint are rejected", () => {
  assert.throws(
    () => splitEdgeAt(fixture(), 0, 0.00001),
    (error) => error instanceof GeometryEditError && error.code === "split-too-close-to-vertex",
  );
});

test("free interior points create solver-safe auxiliary topology", () => {
  const graph = blankSquare();
  const faceIndex = findContainingFace(graph, [5, 5]);
  const inserted = insertInteriorVertex(graph, faceIndex, [5, 5]);
  assert.equal(inserted.vertexIndex, 4);
  assert.equal(inserted.graph.vertices_coords?.length, 5);
  assert.equal(inserted.graph.edges_vertices.length, 8);
  assert.equal(inserted.graph.faces_vertices?.length, 4);
  assert.deepEqual(inserted.graph.edges_assignment.slice(4), ["F", "F", "F", "F"]);
  assert.deepEqual(inserted.graph.edges_origamiLabAuxiliary, [false, false, false, false, true, true, true, true]);
  assertFaceTopology(inserted.graph);
});

test("snapping prioritizes vertices, then edges, then grid", () => {
  const graph = blankSquare();
  const vertex = snapPointToGraph(graph, [0.1, 0.1], { tolerance: 0.5, gridEnabled: true, gridSize: 2 });
  assert.equal(vertex.kind, "vertex");
  const edge = snapPointToGraph(graph, [5.1, 0.2], { tolerance: 0.5, gridEnabled: true, gridSize: 2 });
  assert.equal(edge.kind, "edge");
  const grid = snapPointToGraph(graph, [4.2, 6.7], { tolerance: 0.1, gridEnabled: true, gridSize: 2 });
  assert.equal(grid.kind, "grid");
  assert.deepEqual(grid.point, [4, 6]);
});

test("a crease crossing an existing crease creates an automatic intersection", () => {
  const graph = {
    file_spec: 1.1,
    vertices_coords: [[0, 0], [10, 0], [10, 10], [0, 10], [5, 0], [5, 10]],
    edges_vertices: [[0, 4], [4, 1], [1, 2], [2, 5], [5, 3], [3, 0], [4, 5]],
    edges_assignment: ["B", "B", "B", "B", "B", "B", "V"],
    edges_foldAngle: [0, 0, 0, 0, 0, 0, 180],
    faces_vertices: [[0, 4, 5, 3], [4, 1, 2, 5]],
  };

  const leftEdge = findEdge(graph, 3, 0);
  const left = splitEdgeAt(graph, leftEdge, 0.5);
  const rightEdge = findEdge(left.graph, 1, 2);
  const right = splitEdgeAt(left.graph, rightEdge, 0.5);
  const traced = traceCreaseBetweenVertices(right.graph, left.vertexIndex, right.vertexIndex, "V", 180);

  assert.equal(traced.intersectionVertices.length, 1);
  assert.equal(traced.graph.vertices_coords?.length, 9);
  assert.equal(traced.graph.faces_vertices?.length, 4);
  assert.equal(traced.graph.edges_assignment.filter((assignment) => assignment === "V").length, 4);
  assertFaceTopology(traced.graph);
});

function findEdge(graph: { edges_vertices: readonly (readonly [number, number])[] }, a: number, b: number): number {
  const index = graph.edges_vertices.findIndex(([c, d]) => (a === c && b === d) || (a === d && b === c));
  assert.notEqual(index, -1, `missing edge ${a}-${b}`);
  return index;
}

function assertFaceTopology(graph: { edges_vertices: readonly (readonly [number, number])[]; faces_vertices?: readonly (readonly number[])[] }): void {
  for (const face of graph.faces_vertices ?? []) {
    assert.ok(face.length >= 3, "face must have at least three vertices");
    for (let index = 0; index < face.length; index += 1) {
      assert.notEqual(findEdge(graph, face[index]!, face[(index + 1) % face.length]!), -1);
    }
  }
}
