# Origami Lab editor shell

The v0.2 shell is a modern UI that deliberately treats the original application as a numerical service rather than its rendering/UI layer.

## Architecture

```text
apps/lab (Vite + TypeScript)
  |
  +-- FOLD editor / validation ---- @origami-lab/core
  |
  +-- modern Three.js renderer
  |
  `-- hidden same-origin iframe
        |
        `-- OrigamiSimulator legacy app
              |
              `-- origamiLabLegacyBridge
                    |
                    `-- legacy WebGL solver
```

This lets the new editor evolve without rewriting the numerical engine. The iframe is kept off-screen rather than `display:none` so Chromium can reliably create its WebGL context.

## Current capabilities

- import/export FOLD JSON;
- visual 2D crease graph;
- select an edge and edit assignment / target angle;
- FOLD normalization and diagnostics from `@origami-lab/core`;
- fold-percent control;
- deterministic invocation of the legacy WebGL solver;
- independent modern Three.js rendering of returned vertex positions;
- basic mouse rotation of the 3D result;
- responsive desktop/mobile shell.

## Development

```bash
cd apps/lab
npm install
npm run dev
```

Open `http://localhost:5173/apps/lab/`.

The original simulator remains available at `/index.html` and is also used internally as the solver runtime.

## Next editor milestones

1. draw/add/delete vertices and creases;
2. snapping (vertex, grid, angular, symmetry);
3. undo/redo command history;
4. polygon/facet reconstruction after graph edits;
5. richer selection and multi-edge operations;
6. timeline / fold-sequence authoring.
