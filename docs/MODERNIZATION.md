# Origami Lab modernization plan

## Compatibility rule

The original static application and its numerical solver are the reference implementation during the v0.1 migration. The modernization must not change solver equations or numerical behavior until reproducibility tests exist.

Baseline fork commit: `7855983a613c879c171b2b1557f8cd102d2640cf`.

Reference solver files include:

- `js/dynamic/dynamicSolver.js`
- `js/dynamic/GPUMath.js`
- `js/dynamic/GLBoilerplate.js`
- `js/staticSolver.js`
- `js/rigidSolver.js`

## Target architecture

```text
FOLD / SVG / editor
        |
        v
  @origami-lab/core
  normalize + validate
        |
        v
 SimulationEngine
   |      |      |
legacy   WebGPU   CPU
WebGL
   \      |      /
       frames
         |
         v
 renderer / analysis / export
```

The solver API is intentionally independent from rendering and UI state. This enables Web Workers, batch simulation, headless tests, parameter sweeps, and future inverse-design workflows.

## v0.1 milestones

1. **Core contracts and FOLD validation** — added first, with zero changes to the legacy application.
2. **Legacy solver adapter** — wrap the existing dynamic solver behind the new interface and create regression fixtures.
3. **Modern development shell** — Vite + TypeScript editor application served separately from the legacy root.
4. **2D crease editor** — interactive graph editing, snapping, assignments, target angles, undo/redo.
5. **Synchronized 2D/3D view** — edits flow through validation into the legacy solver.

## v0.2+

- WebGPU compute backend with WebGL fallback.
- fold sequence / timeline and FOLD frame export.
- batch/headless simulation API.
- optional thickness, self-collision, and layer ordering.
- WebXR visualization.
- generative and inverse origami design.
