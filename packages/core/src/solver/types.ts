import type { NormalizedFoldGraph } from "../fold/types.js";

export type SolverBackend = "legacy-webgl" | "webgpu" | "cpu";

export interface SolverCapabilities {
  backend: SolverBackend;
  dynamic: boolean;
  rigid: boolean;
  selfCollision: boolean;
  thickness: boolean;
  batch: boolean;
}

export interface SimulationRequest {
  graph: NormalizedFoldGraph;
  foldPercent: number;
  maxIterations?: number;
  tolerance?: number;
}

export interface SimulationFrame {
  verticesCoords: number[][];
  creaseAngles?: Array<number | null>;
  iteration: number;
  residual?: number;
  converged?: boolean;
}

export interface OrigamiSolver {
  readonly id: string;
  readonly capabilities: SolverCapabilities;
  simulate(request: SimulationRequest): Promise<SimulationFrame>;
  dispose?(): void | Promise<void>;
}
