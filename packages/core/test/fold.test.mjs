import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidFaceDiagonal,
  normalizeFoldGraph,
  projectVertices2D,
  triangulateFace,
  validateFoldForSimulation,
  validateFoldGraph,
} from "../dist/index.js";

test("normalizer infers canonical target angles when edges_foldAngle is absent", () => {
  const { graph, diagnostics } = normalizeFoldGraph({
    vertices_coords: [[0, 0], [1, 0], [1, 1]],
    edges_vertices: [[0, 1], [1, 2], [2, 0]],
    edges_assignment: ["V", "M", "B"],
  });

  assert.deepEqual(graph.edges_foldAngle, [180, -180, 0]);
  assert.equal(diagnostics.some(({ code }) => code === "missing-fold-angles"), true);
});

test("normalizer degrades unsupported assignments to U instead of crashing", () => {
  const { graph, diagnostics } = normalizeFoldGraph({
    vertices_coords: [[0, 0], [1, 0]],
    edges_vertices: [[0, 1]],
    edges_assignment: ["X"],
  });

  assert.equal(graph.edges_assignment[0], "U");
  assert.equal(graph.edges_foldAngle[0], 0);
  assert.equal(diagnostics.some(({ code }) => code === "unsupported-edge-assignment"), true);
});

test("normalizer uses edges_vertices as canonical cardinality", () => {
  const { graph, diagnostics } = normalizeFoldGraph({
    vertices_coords: [[0, 0], [1, 0]],
    edges_vertices: [[0, 1]],
    edges_assignment: ["V", "M", "B"],
    edges_foldAngle: [90, -90, 0],
  });

  assert.equal(graph.edges_vertices.length, 1);
  assert.equal(graph.edges_assignment.length, 1);
  assert.equal(graph.edges_foldAngle.length, 1);
  assert.equal(diagnostics.some(({ code }) => code === "orphan-edge-assignments"), true);
  assert.equal(diagnostics.some(({ code }) => code === "orphan-fold-angles"), true);
});

test("validator catches invalid topology without throwing", () => {
  const result = validateFoldGraph({
    vertices_coords: [[0, 0], [1, 0]],
    edges_vertices: [[0, 2], [1, 1]],
    edges_assignment: ["V", "M"],
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.some(({ code }) => code === "edge-index-out-of-range"), true);
  assert.equal(result.errors.some(({ code }) => code === "degenerate-edge"), true);
});

test("validator warns on fold angle sign mismatch", () => {
  const result = validateFoldGraph({
    vertices_coords: [[0, 0], [1, 0]],
    edges_vertices: [[0, 1]],
    edges_assignment: ["M"],
    edges_foldAngle: [90],
  });

  assert.equal(result.valid, true);
  assert.equal(result.warnings.some(({ code }) => code === "fold-angle-sign-mismatch"), true);
});

test("simulation validation rejects missing faces, impossible angles, and unsupported J", () => {
  const missingFaces = validateFoldForSimulation({
    vertices_coords: [[0, 0], [1, 0]],
    edges_vertices: [[0, 1]],
    edges_assignment: ["B"],
    edges_foldAngle: [0],
  });
  assert.equal(missingFaces.valid, false);
  assert.equal(missingFaces.errors.some(({ code }) => code === "simulation-missing-faces"), true);

  const invalidAngle = validateFoldForSimulation({
    vertices_coords: [[0, 0], [1, 0], [0, 1]],
    edges_vertices: [[0, 1], [1, 2], [2, 0]],
    edges_assignment: ["B", "B", "J"],
    edges_foldAngle: [0, 0, 9999],
    faces_vertices: [[0, 1, 2]],
  });
  assert.equal(invalidAngle.valid, false);
  assert.equal(invalidAngle.errors.some(({ code }) => code === "simulation-angle-range"), true);
  assert.equal(invalidAngle.errors.some(({ code }) => code === "simulation-unsupported-assignment"), true);
});

test("simulation validation requires each face boundary to exist as an edge", () => {
  const result = validateFoldForSimulation({
    vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1]],
    edges_vertices: [[0, 1], [1, 2], [2, 3]],
    edges_assignment: ["B", "B", "B"],
    edges_foldAngle: [0, 0, 0],
    faces_vertices: [[0, 1, 2, 3]],
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.some(({ code }) => code === "simulation-missing-face-edge"), true);
});

test("projection chooses XY for a conventional 3D flat pattern", () => {
  assert.deepEqual(
    projectVertices2D([[0, 0, 0], [2, 0, 0], [2, 1, 0], [0, 1, 0]]),
    [[0, 0], [2, 0], [2, 1], [0, 1]],
  );
});

test("concave outside diagonal is rejected and concave face triangulates", () => {
  const vertices = [[0, 0], [3, 0], [3, 3], [1.5, 1], [0, 3]];
  const face = [0, 1, 2, 3, 4];
  assert.equal(isValidFaceDiagonal(face, vertices, 2, 4), false);
  const triangles = triangulateFace(face, vertices);
  assert.equal(triangles.length, 9);
});
