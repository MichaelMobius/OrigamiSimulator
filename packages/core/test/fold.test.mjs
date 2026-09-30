import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFoldGraph, validateFoldGraph } from "../dist/index.js";

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
