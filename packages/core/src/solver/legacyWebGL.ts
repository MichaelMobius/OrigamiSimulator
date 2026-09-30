import type {
  OrigamiSolver,
  SimulationFrame,
  SimulationRequest,
  SolverCapabilities,
} from "./types.js";

export interface LegacyWebGLSnapshot {
  verticesCoords: number[][];
  creaseAngles?: Array<number | null>;
  /**
   * Convergence/error value reported by the runtime bridge. The browser bridge
   * reports the legacy global error in percent, matching the existing UI.
   */
  residual?: number;
}

export interface LegacyWebGLRuntimeBridge {
  loadFold(graph: SimulationRequest["graph"]): void | Promise<void>;
  setFoldPercent(percent: number): void | Promise<void>;
  step(steps: number): void | Promise<void>;
  snapshot(): LegacyWebGLSnapshot | Promise<LegacyWebGLSnapshot>;
  reset?(): void | Promise<void>;
  release?(): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

export interface LegacyWebGLSolverOptions {
  defaultIterations?: number;
  chunkSize?: number;
}

/**
 * Wraps the original browser/WebGL dynamic solver behind the modern solver
 * contract. Numerical behavior remains entirely inside the legacy runtime.
 */
export class LegacyWebGLSolverAdapter implements OrigamiSolver {
  readonly id = "legacy-webgl";
  readonly capabilities: SolverCapabilities = {
    backend: "legacy-webgl",
    dynamic: true,
    rigid: false,
    selfCollision: false,
    thickness: false,
    batch: false,
  };

  private readonly defaultIterations: number;
  private readonly chunkSize: number;

  constructor(
    private readonly runtime: LegacyWebGLRuntimeBridge,
    options: LegacyWebGLSolverOptions = {},
  ) {
    this.defaultIterations = positiveInteger(options.defaultIterations, 100);
    this.chunkSize = positiveInteger(options.chunkSize, 25);
  }

  async simulate(request: SimulationRequest): Promise<SimulationFrame> {
    const foldPercent = finiteNumber(request.foldPercent, "foldPercent");
    const maxIterations = nonNegativeInteger(request.maxIterations, this.defaultIterations);
    const tolerance = optionalNonNegativeFinite(request.tolerance, "tolerance");

    try {
      await this.runtime.loadFold(request.graph);
      await this.runtime.setFoldPercent(foldPercent);

      let iteration = 0;
      let snapshot = await this.runtime.snapshot();
      let converged = tolerance !== undefined && isAtTolerance(snapshot.residual, tolerance);

      while (iteration < maxIterations && !converged) {
        const steps = Math.min(this.chunkSize, maxIterations - iteration);
        await this.runtime.step(steps);
        iteration += steps;
        snapshot = await this.runtime.snapshot();
        converged = tolerance !== undefined && isAtTolerance(snapshot.residual, tolerance);
      }

      const frame: SimulationFrame = {
        verticesCoords: cloneVertices(snapshot.verticesCoords),
        iteration,
      };
      if (snapshot.creaseAngles !== undefined) frame.creaseAngles = snapshot.creaseAngles.slice();
      if (snapshot.residual !== undefined) frame.residual = snapshot.residual;
      if (tolerance !== undefined) frame.converged = converged;
      return frame;
    } finally {
      await this.runtime.release?.();
    }
  }

  async dispose(): Promise<void> {
    await this.runtime.dispose?.();
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError("Expected a positive integer.");
  }
  return value;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError("maxIterations must be a non-negative integer.");
  }
  return value;
}

function finiteNumber(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
  return value;
}

function optionalNonNegativeFinite(
  value: number | undefined,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;
  finiteNumber(value, name);
  if (value < 0) throw new RangeError(`${name} must be non-negative.`);
  return value;
}

function isAtTolerance(residual: number | undefined, tolerance: number): boolean {
  return residual !== undefined && Number.isFinite(residual) && residual <= tolerance;
}

function cloneVertices(vertices: number[][]): number[][] {
  return vertices.map((vertex) => vertex.slice());
}
