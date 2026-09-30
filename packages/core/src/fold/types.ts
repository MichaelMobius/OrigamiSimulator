export const SUPPORTED_EDGE_ASSIGNMENTS = ["B", "M", "V", "F", "U", "J", "C"] as const;

export type EdgeAssignment = (typeof SUPPORTED_EDGE_ASSIGNMENTS)[number];
export type FoldAngle = number | null;
export type Vertex = readonly number[];
export type Edge = readonly [number, number];

export interface FoldGraph {
  file_spec?: number;
  file_creator?: string;
  file_author?: string;
  frame_title?: string;
  frame_classes?: string[];
  vertices_coords?: Vertex[];
  edges_vertices?: Edge[];
  edges_assignment?: string[];
  edges_foldAngle?: FoldAngle[];
  faces_vertices?: number[][];
  [key: string]: unknown;
}

export interface NormalizedFoldGraph extends FoldGraph {
  edges_vertices: Edge[];
  edges_assignment: EdgeAssignment[];
  edges_foldAngle: FoldAngle[];
}

export type ValidationSeverity = "error" | "warning";

export interface FoldDiagnostic {
  severity: ValidationSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface FoldValidationResult {
  valid: boolean;
  errors: FoldDiagnostic[];
  warnings: FoldDiagnostic[];
  diagnostics: FoldDiagnostic[];
}

export interface FoldNormalizationResult {
  graph: NormalizedFoldGraph;
  diagnostics: FoldDiagnostic[];
}
