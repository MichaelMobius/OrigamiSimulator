# Legacy WebGL adapter

Milestone 2 preserves the original numerical implementation and places a narrow API around it.

## Boundary

`LegacyWebGLSolverAdapter` implements the modern `OrigamiSolver` contract, but it does not contain any physics. It delegates every numerical step to a `LegacyWebGLRuntimeBridge`.

The browser bridge is `js/origamiLabLegacyBridge.js`. It uses only existing public-ish legacy objects:

- `pattern.setFoldData()` for FOLD preprocessing and triangulation;
- `model.buildModel()` / `model.sync()` for model construction;
- `model.step()` for deterministic solver steps;
- `model.getPositionsArray()` for simulation output;
- `#globalError` for the legacy mean error value already shown in the UI.

The bridge requests crease parameters with `returnCreaseParams=true`, which avoids treating programmatic runs as user uploads. It always deep-clones input because the legacy FOLD preprocessing pipeline mutates and triangulates its graph.

## Residual units

The browser bridge exposes the existing `globalError` value in **percent**. Therefore `SimulationRequest.tolerance` must also be expressed in percent when this bridge is used.

## Browser usage

Load `js/origamiLabLegacyBridge.js` alongside the legacy application. The script can be loaded before `main.js` because it resolves `window.globals` lazily when a simulation method is called.

```js
const bridge = window.origamiLabLegacyBridge;
if (!bridge.isReady()) throw new Error("legacy runtime is still initializing");

bridge.loadFold(fold);
bridge.setFoldPercent(0.75);
bridge.step(100);
const snapshot = bridge.snapshot();
bridge.release();
```

The adapter restores the legacy animation state via `release()` after each `simulate()` call.

## Regression strategy

`packages/core/test/fixtures/single-hinge.fold.json` is the first canonical fixture. Current CI verifies normalization, adapter iteration behavior, defensive cloning, output capture, and animation-state restoration.

The next regression layer will run canonical fixtures through a real browser/WebGL context and save numerical vertex snapshots. Those snapshots must exist before the WebGPU solver is allowed to replace any legacy equation.
