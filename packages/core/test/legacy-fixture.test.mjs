import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { normalizeFoldGraph, validateFoldGraph } from "../dist/index.js";

const fixture = JSON.parse(
  fs.readFileSync(new URL("./fixtures/single-hinge.fold.json", import.meta.url), "utf8"),
);

test("single-hinge regression fixture is a valid normalized FOLD graph", () => {
  const { graph } = normalizeFoldGraph(fixture);
  const validation = validateFoldGraph(graph);

  assert.equal(validation.valid, true);
  assert.equal(graph.vertices_coords.length, 4);
  assert.equal(graph.edges_vertices.length, 5);
  assert.equal(graph.faces_vertices.length, 2);
  assert.equal(graph.edges_foldAngle[4], 90);
});
