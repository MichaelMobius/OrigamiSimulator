import {
  SUPPORTED_EDGE_ASSIGNMENTS,
  type Edge,
  type EdgeAssignment,
  type FoldAngle,
  type FoldDiagnostic,
  type FoldGraph,
  type FoldNormalizationResult,
  type NormalizedFoldGraph,
} from "./types.js";

const ASSIGNMENTS = new Set<string>(SUPPORTED_EDGE_ASSIGNMENTS);

export function defaultFoldAngle(assignment: EdgeAssignment): number {
  if (assignment === "V") return 180;
  if (assignment === "M") return -180;
  return 0;
}

function edgeCount(graph: FoldGraph): number {
  return Math.max(
    graph.edges_vertices?.length ?? 0,
    graph.edges_assignment?.length ?? 0,
    graph.edges_foldAngle?.length ?? 0,
  );
}

function normalizeAssignment(
  value: string | undefined,
  index: number,
  diagnostics: FoldDiagnostic[],
): EdgeAssignment {
  if (value === undefined || value === "") return "U";
  if (ASSIGNMENTS.has(value)) return value as EdgeAssignment;

  diagnostics.push({
    severity: "warning",
    code: "unsupported-edge-assignment",
    message: `Unsupported edge assignment '${value}' was replaced with 'U'.`,
    path: `edges_assignment[${index}]`,
  });
  return "U";
}

export function normalizeFoldGraph(input: FoldGraph): FoldNormalizationResult {
  const diagnostics: FoldDiagnostic[] = [];
  const count = edgeCount(input);
  const sourceEdges = input.edges_vertices ?? [];
  const sourceAssignments = input.edges_assignment ?? [];
  const sourceAngles = input.edges_foldAngle;

  const edges: Edge[] = [];
  const assignments: EdgeAssignment[] = [];
  const angles: FoldAngle[] = [];

  for (let index = 0; index < count; index += 1) {
    const edge = sourceEdges[index];
    if (edge !== undefined) edges.push([edge[0], edge[1]]);

    const assignment = normalizeAssignment(sourceAssignments[index], index, diagnostics);
    assignments.push(assignment);

    const angle = sourceAngles?.[index];
    angles.push(angle === undefined ? defaultFoldAngle(assignment) : angle);
  }

  if (sourceAngles === undefined && count > 0) {
    diagnostics.push({
      severity: "warning",
      code: "missing-fold-angles",
      message: "edges_foldAngle was missing; target angles were inferred from edge assignments.",
      path: "edges_foldAngle",
    });
  }

  if ((input.edges_assignment?.length ?? 0) < count) {
    diagnostics.push({
      severity: "warning",
      code: "missing-edge-assignments",
      message: "Missing edge assignments were filled with 'U'.",
      path: "edges_assignment",
    });
  }

  const graph: NormalizedFoldGraph = {
    ...input,
    edges_vertices: edges,
    edges_assignment: assignments,
    edges_foldAngle: angles,
  };

  return { graph, diagnostics };
}
