import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(
  new URL("../../../js/origamiLabLegacyBridge.js", import.meta.url),
  "utf8",
);

test("browser bridge loads a defensive FOLD copy and snapshots legacy positions", () => {
  const calls = [];
  const input = {
    vertices_coords: [[0, 0], [1, 0]],
    faces_vertices: [],
    edges_vertices: [],
    edges_assignment: [],
    edges_foldAngle: [],
  };
  const processed = { ...input, vertices_coords: [[9, 9, 9]] };
  const g = {
    simulationRunning: true,
    foldUseAngles: false,
    shouldChangeCreasePercent: false,
    dynamicSolver: {},
    setCreasePercent(value) {
      calls.push(["percent", value]);
    },
    pattern: {
      setFoldData(graph, isDemo, returnCreaseParams) {
        calls.push(["setFoldData", isDemo, returnCreaseParams]);
        graph.vertices_coords[0][0] = 99;
        return [[0, 0, 1, 1, 0, 90]];
      },
      getFoldData() {
        return processed;
      },
    },
    model: {
      buildModel(fold, creaseParams) {
        calls.push(["buildModel", fold, creaseParams]);
      },
      pause() {
        calls.push(["pause"]);
      },
      sync() {
        calls.push(["sync"]);
      },
      reset() {
        calls.push(["reset"]);
      },
      step(count) {
        calls.push(["step", count]);
      },
      resume() {
        calls.push(["resume"]);
      },
      getPositionsArray() {
        return new Float32Array([1, 2, 3, 4, 5, 6]);
      },
    },
  };

  const window = {
    globals: g,
    document: {
      getElementById() {
        return { textContent: "0.1250000 %" };
      },
    },
  };
  const context = vm.createContext({
    window,
    Number,
    JSON,
    Array,
    Error,
    RangeError,
    parseFloat,
  });
  vm.runInContext(source, context);

  const bridge = window.origamiLabLegacyBridge;
  bridge.loadFold(input);
  assert.equal(input.vertices_coords[0][0], 0, "input graph must not be mutated");

  bridge.setFoldPercent(0.5);
  bridge.step(12);
  const snapshot = JSON.parse(JSON.stringify(bridge.snapshot()));
  assert.deepEqual(snapshot, {
    verticesCoords: [[1, 2, 3], [4, 5, 6]],
    residual: 0.125,
  });

  bridge.release();
  assert.equal(g.foldUseAngles, true);
  assert.equal(g.shouldChangeCreasePercent, true);
  assert.ok(calls.some((call) => call[0] === "resume"));
});
