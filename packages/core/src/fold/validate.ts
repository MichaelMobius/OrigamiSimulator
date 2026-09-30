import {
  SUPPORTED_EDGE_ASSIGNMENTS,
  type FoldDiagnostic,
  type FoldGraph,
  type FoldValidationResult,
} from "./types.js";

const ASSIGNMENTS = new Set<string>(SUPPORTED_EDGE_ASSIGNMENTS);

function add(
  diagnostics: FoldDiagnostic[],
  severity: "error" | "warning",
  code: string,
  message: string,
  path?: string,
): void {
  diagnostics.push(path === undefined ? { severity, code, message } : { severity, code, message, path });
}

function finiteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateFoldGraph(graph: FoldGraph): FoldValidationResult {
  const diagnostics: FoldDiagnostic[] = [];
  const vertices = graph.vertices_coords ?? [];
  const edges = graph.edges_vertices ?? [];

  if (vertices.length === 0) {
    add(diagnostics, "error", "missing-vertices", "vertices_coords must contain at least one vertex.", "vertices_coords");
  }

  vertices.forEach((vertex, index) => {
    if (vertex.length < 2 || !vertex.every(finiteCoordinate)) {
      add(
        diagnostics,
        "error",
        "invalid-vertex",
        "Each vertex must contain at least two finite numeric coordinates.",
        `vertices_coords[${index}]`,
      );
    }
  });

  const seenEdges = new Set<string>();
  edges.forEach((edge, index) => {
    if (!Array.isArray(edge) || edge.length !== 2 || !Number.isInteger(edge[0]) || !Number.isInteger(edge[1])) {
      add(diagnostics, "error", "invalid-edge", "Each edge must contain exactly two integer vertex indices.", `edges_vertices[${index}]`);
      return;
    }

    const [a, b] = edge;
    if (a < 0 || b < 0 || a >= vertices.length || b >= vertices.length) {
      add(diagnostics, "error", "edge-index-out-of-range", "Edge references a vertex that does not exist.", `edges_vertices[${index}]`);
    }
    if (a === b) {
      add(diagnostics, "error", "degenerate-edge", "An edge cannot connect a vertex to itself.", `edges_vertices[${index}]`);
    }

    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seenEdges.has(key)) {
      add(diagnostics, "warning", "duplicate-edge", "Duplicate undirected edge detected.", `edges_vertices[${index}]`);
    }
    seenEdges.add(key);
  });

  if (graph.edges_assignment !== undefined && graph.edges_assignment.length !== edges.length) {
    add(diagnostics, "warning", "assignment-length-mismatch", "edges_assignment length does not match edges_vertices length.", "edges_assignment");
  }

  graph.edges_assignment?.forEach((assignment, index) => {
    if (!ASSIGNMENTS.has(assignment)) {
      add(diagnostics, "warning", "unsupported-edge-assignment", `Unsupported edge assignment '${assignment}'.`, `edges_assignment[${index}]`);
    }
  });

  if (graph.edges_foldAngle !== undefined && graph.edges_foldAngle.length !== edges.length) {
    add(diagnostics, "warning", "fold-angle-length-mismatch", "edges_foldAngle length does not match edges_vertices length.", "edges_foldAngle");
  }

  graph.edges_foldAngle?.forEach((angle, index) => {
    if (angle !== null && !finiteCoordinate(angle)) {
      add(diagnostics, "error", "invalid-fold-angle", "Fold angle must be a finite number or null.", `edges_foldAngle[${index}]`);
      return;
    }

    const assignment = graph.edges_assignment?.[index];
    if (typeof angle !== "number" || assignment === undefined) return;
    if (assignment === "V" && angle < 0) {
      add(diagnostics, "warning", "fold-angle-sign-mismatch", "Valley fold has a negative target angle.", `edges_foldAngle[${index}]`);
    }
    if (assignment === "M" && angle > 0) {
      add(diagnostics, "warning", "fold-angle-sign-mismatch", "Mountain fold has a positive target angle.", `edges_foldAngle[${index}]`);
    }
  });

  graph.faces_vertices?.forEach((face, faceIndex) => {
    if (!Array.isArray(face) || face.length < 3) {
      add(diagnostics, "error", "invalid-face", "Each face must contain at least three vertex indices.", `faces_vertices[${faceIndex}]`);
      return;
    }

    const local = new Set<number>();
    face.forEach((vertexIndex, index) => {
      if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= vertices.length) {
        add(diagnostics, "error", "face-index-out-of-range", "Face references a vertex that does not exist.", `faces_vertices[${faceIndex}][${index}]`);
      }
      if (local.has(vertexIndex)) {
        add(diagnostics, "warning", "duplicate-face-vertex", "Face contains the same vertex more than once.", `faces_vertices[${faceIndex}]`);
      }
      local.add(vertexIndex);
    });
  });

  const errors = diagnostics.filter(({ severity }) => severity === "error");
  const warnings = diagnostics.filter(({ severity }) => severity === "warning");
  return { valid: errors.length === 0, errors, warnings, diagnostics };
}
