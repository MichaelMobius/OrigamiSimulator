import test from "node:test";
import assert from "node:assert/strict";
import {
  angularSnapPoint,
  edgeMeasurement,
  findMidpointSnap,
  mirrorPattern,
  moveVertexSafely,
  snapMovePointToGrid,
} from "../src/precisionCad.ts";
import { GeometryEditError } from "../src/geometryEditor.ts";

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

test("edge measurement reports length, angle, and midpoint", () => {
  const measured = edgeMeasurement(square(), 4)!;
  assert.ok(Math.abs(measured.length - Math.sqrt(20_000)) < 1e-9);
  assert.ok(Math.abs(measured.angleDegrees - 45) < 1e-9);
  assert.deepEqual(measured.midpoint, [50, 50]);
});

test("midpoint snapping prefers the exact middle of a nearby edge", () => {
  const snap = findMidpointSnap(square(), [51, 1], 3)!;
  assert.equal(snap.edgeIndex, 0);
  assert.equal(snap.parameter, 0.5);
  assert.deepEqual(snap.point, [50, 0]);
});

test("angular snapping locks near canonical 30/45/60/90 degree directions", () => {
  const graph = square();
  const radius = 50;
  const rawAngle = 43 * Math.PI / 180;
  const result = angularSnapPoint(graph, 0, [Math.cos(rawAngle) * radius, Math.sin(rawAngle) * radius]);
  assert.equal(result.snapped, true);
  assert.equal(result.angleDegrees, 45);
  assert.ok(Math.abs(result.point[0] - result.point[1]) < 1e-9);
});

test("angular snapping leaves distant angles free", () => {
  const graph = square();
  const rawAngle = 18 * Math.PI / 180;
  const raw: [number, number] = [Math.cos(rawAngle) * 50, Math.sin(rawAngle) * 50];
  const result = angularSnapPoint(graph, 0, raw, 4);
  assert.equal(result.snapped, false);
  assert.deepEqual(result.point, raw);
});

test("moving a vertex preserves valid topology", () => {
  const moved = moveVertexSafely(square(), 1, [110, 10]);
  assert.deepEqual(moved.vertices_coords?.[1], [110, 10]);
  assert.equal(moved.faces_vertices?.length, 2);
});

test("moving a vertex across unrelated edges is rejected", () => {
  assert.throws(
    () => moveVertexSafely(square(), 1, [-10, 90]),
    (error) => error instanceof GeometryEditError && ["invalid-face-after-move", "edge-crossing-after-move", "edge-overlap-after-move"].includes(error.code),
  );
});

test("mirror keeps edge metadata and restores face winding convention", () => {
  const mirrored = mirrorPattern(square(), "vertical");
  assert.deepEqual(mirrored.vertices_coords, [[100, 0], [0, 0], [0, 100], [100, 100]]);
  assert.deepEqual(mirrored.edges_assignment, square().edges_assignment);
  assert.deepEqual(mirrored.faces_vertices, [[2, 1, 0], [3, 2, 0]]);
});

test("move snapping rounds to the active grid", () => {
  assert.deepEqual(snapMovePointToGrid([23.2, 46.9], 10), [20, 50]);
});
