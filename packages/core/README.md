# @origami-lab/core

Framework-agnostic foundation for the OrigamiSimulator modernization.

This package deliberately does **not** import the legacy UI, jQuery, Three.js, or WebGL code. Its first responsibilities are:

- define typed FOLD graph structures;
- normalize recoverable FOLD input problems;
- validate topology and crease metadata without crashing the application;
- define a stable solver interface that can be implemented by the legacy WebGL solver, a future WebGPU solver, or a CPU/reference solver.

## Development

```bash
cd packages/core
npm install
npm test
```

The legacy application at the repository root remains unchanged during v0.1 so that it can serve as a behavioral baseline.
