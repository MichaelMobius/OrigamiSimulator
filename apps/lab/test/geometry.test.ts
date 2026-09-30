import test from "node:test";
import assert from "node:assert/strict";
import {
  addCreaseBetweenVertices,
  deleteInternalCrease,
  GeometryEditError,
  GraphHistory,
} from "../src/geometryEditor.ts";

function fixture() {
  return {
    vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1]],
    edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]],
    edges_assignment: ["B", "B", "B", "B", "V"],
    edges_foldAngle: [0, 0, 0, 0, 90],
    faces_vertices: [[0, 1, 2], [0, 2, 3]],
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
