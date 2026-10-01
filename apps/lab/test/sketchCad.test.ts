import test from "node:test";
import assert from "node:assert/strict";
import {
  foldAngleForAssignment,
  pointFromLengthAngle,
  retargetEdgeFromFirstVertex,
} from "../src/sketchCad.ts";

function square() {
  return {
    file_units: "mm",
    vertices_coords: [[0, 0], [100, 0], [100, 100], [0, 100]],
    edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]],
    edges_assignment: ["B", "B", "B", "B", "V"],
    edges_foldAngle: [0, 0, 0, 0, 90],
    faces_vertices: [[0, 1, 2], [0, 2, 3]],
  };
}

test("drawing assignments produce FOLD-compatible signed fold angles", () => {
  assert.equal(foldAngleForAssignment("V", 90), 90);
  assert.equal(foldAngleForAssignment("M", 90), -90);
  assert.equal(foldAngleForAssignment("F", 90), 0);
  assert.equal(foldAngleForAssignment("C", 90), 0);
  assert.equal(foldAngleForAssignment("U", 90), 0);
  assert.equal(foldAngleForAssignment("V", 500), 180);
});

test("exact line endpoint is built from length and angle", () => {
  const point = pointFromLengthAngle([10, 20], 50, 60);
  assert.ok(Math.abs(point[0] - 35) < 1e-9);
  assert.ok(Math.abs(point[1] - (20 + 25 * Math.sqrt(3))) < 1e-9);
});

test("selected edge can be dimensioned by length and planar angle", () => {
  const retargeted = retargetEdgeFromFirstVertex(square(), 0, 80, 30);
  const end = retargeted.vertices_coords?.[1];
  assert.ok(end);
  assert.ok(Math.abs(end![0] - 80 * Math.cos(Math.PI / 6)) < 1e-9);
  assert.ok(Math.abs(end![1] - 40) < 1e-9);
});
