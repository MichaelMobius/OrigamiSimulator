import test from "node:test";
import assert from "node:assert/strict";
import { createRectangularPattern } from "../src/patternFactory.ts";

test("creates a valid rectangular blank sheet topology", () => {
  const graph = createRectangularPattern({ width: 210, height: 297, title: "A4 test" });
  assert.deepEqual(graph.vertices_coords, [[0, 0], [210, 0], [210, 297], [0, 297]]);
  assert.deepEqual(graph.edges_vertices, [[0, 1], [1, 2], [2, 3], [3, 0]]);
  assert.deepEqual(graph.edges_assignment, ["B", "B", "B", "B"]);
  assert.deepEqual(graph.edges_foldAngle, [0, 0, 0, 0]);
  assert.deepEqual(graph.faces_vertices, [[0, 1, 2, 3]]);
  assert.equal(graph.frame_title, "A4 test");
  assert.equal(graph.file_units, "mm");
});

test("rejects invalid paper dimensions", () => {
  assert.throws(() => createRectangularPattern({ width: 0, height: 100 }), /width/i);
  assert.throws(() => createRectangularPattern({ width: 100, height: Number.NaN }), /height/i);
  assert.throws(() => createRectangularPattern({ width: 10_001, height: 100 }), /10000/);
});
