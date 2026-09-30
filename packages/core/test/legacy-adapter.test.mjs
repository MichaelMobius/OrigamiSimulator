import assert from "node:assert/strict";
import test from "node:test";
import { LegacyWebGLSolverAdapter } from "../dist/index.js";

test("legacy adapter advances in deterministic chunks and stops at tolerance", async () => {
  let residual = 1;
  let released = false;
  const steps = [];
  const runtime = {
    loadFold() {},
    setFoldPercent(percent) {
      assert.equal(percent, 0.75);
    },
    step(count) {
      steps.push(count);
      residual -= 0.3;
    },
    snapshot() {
      return { verticesCoords: [[1, 2, 3]], residual };
    },
    release() {
      released = true;
    },
  };

  const solver = new LegacyWebGLSolverAdapter(runtime, { chunkSize: 10 });
  const frame = await solver.simulate({
    graph: {},
    foldPercent: 0.75,
    maxIterations: 80,
    tolerance: 0.15,
  });

  assert.deepEqual(steps, [10, 10, 10]);
  assert.equal(frame.iteration, 30);
  assert.equal(frame.converged, true);
  assert.ok(frame.residual <= 0.15);
  assert.equal(released, true);
});

test("legacy adapter reports unconverged when iteration budget is exhausted", async () => {
  const runtime = {
    loadFold() {},
    setFoldPercent() {},
    step() {},
    snapshot() {
      return { verticesCoords: [[0, 0, 0]], residual: 4 };
    },
  };

  const solver = new LegacyWebGLSolverAdapter(runtime, { chunkSize: 8 });
  const frame = await solver.simulate({
    graph: {},
    foldPercent: 0,
    maxIterations: 17,
    tolerance: 0.01,
  });

  assert.equal(frame.iteration, 17);
  assert.equal(frame.converged, false);
});
