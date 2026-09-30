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
  const raw = graph as Record<string, unknown>;

  const vertices = Array.isArray(raw.vertices_coords) ? raw.vertices_coords : [];
  if (raw.vertices_coords !== undefined && !Array.isArray(raw.vertices_coords)) {
    add(diagnostics, "error", "invalid-vertices-array", "vertices_coords must be an array.", "vertices_coords");
  }
  if (vertices.length === 0) {
    add(diagnostics, "error", "missing-vertices", "vertices_coords must contain at least one vertex.", "vertices_coords");
  }

  vertices.forEach((vertex, index) => {
    if (!Array.isArray(vertex) || vertex.length < 2 || !vertex.every(finiteCoordinate)) {
      add(
        diagnostics,
        "error",
        "invalid-vertex",
        "Each vertex must contain at least two finite numeric coordinates.",
        `vertices_coords[${index}]`,
      );
    }
  });

  const edges = Array.isArray(raw.edges_vertices) ? raw.edges_vertices : [];
  if (raw.edges_vertices !== undefined && !Array.isArray(raw.edges_vertices)) {
    add(diagnostics, "error", "invalid-edges-array", "edges_vertices must be an array.", "edges_vertices");
  }

  const seenEdges = new Set<string>();
  edges.forEach((edge, index) => {
    if (!Array.isArray(edge) || edge.length !== 2 || !Number.isInteger(edge[0]) || !Number.isInteger(edge[1])) {
      add(diagnostics, "error", "invalid-edge", "Each edge must contain exactly two integer vertex indices.", `edges_vertices[${index}]`);
      return;
    }

    const a = edge[0] as number;
    const b = edge[1] as number;
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

  const assignments = Array.isArray(raw.edges_assignment) ? raw.edges_assignment : undefined;
  if (raw.edges_assignment !== undefined && !assignments) {
    add(diagnostics, "error", "invalid-assignments-array", "edges_assignment must be an array.", "edges_assignment");
  }
  if (assignments !== undefined && assignments.length !== edges.length) {
    add(diagnostics, "warning", "assignment-length-mismatch", "edges_assignment length does not match edges_vertices length.", "edges_assignment");
  }

  assignments?.forEach((assignment, index) => {
    if (typeof assignment !== "string" || !ASSIGNMENTS.has(assignment)) {
      add(diagnostics, "warning", "unsupported-edge-assignment", `Unsupported edge assignment '${String(assignment)}'.`, `edges_assignment[${index}]`);
    }
  });

  const angles = Array.isArray(raw.edges_foldAngle) ? raw.edges_foldAngle : undefined;
  if (raw.edges_foldAngle !== undefined && !angles) {
    add(diagnostics, "error", "invalid-fold-angles-array", "edges_foldAngle must be an array.", "edges_foldAngle");
  }
  if (angles !== undefined && angles.length !== edges.length) {
    add(diagnostics, "warning", "fold-angle-length-mismatch", "edges_foldAngle length does not match edges_vertices length.", "edges_foldAngle");
  }

  angles?.forEach((angle, index) => {
    if (angle !== null && !finiteCoordinate(angle)) {
      add(diagnostics, "error", "invalid-fold-angle", "Fold angle must be a finite number or null.", `edges_foldAngle[${index}]`);
      return;
    }

    const assignment = assignments?.[index];
    if (typeof angle !== "number" || typeof assignment !== "string") return;
    if (assignment === "V" && angle < 0) {
      add(diagnostics, "warning", "fold-angle-sign-mismatch", "Valley fold has a negative target angle.", `edges_foldAngle[${index}]`);
    }
    if (assignment === "M" && angle > 0) {
      add(diagnostics, "warning", "fold-angle-sign-mismatch", "Mountain fold has a positive target angle.", `edges_foldAngle[${index}]`);
    }
  });

  const faces = Array.isArray(raw.faces_vertices) ? raw.faces_vertices : undefined;
  if (raw.faces_vertices !== undefined && !faces) {
    add(diagnostics, "error", "invalid-faces-array", "faces_vertices must be an array.", "faces_vertices");
  }
  faces?.forEach((face, faceIndex) => {
    if (!Array.isArray(face) || face.length < 3) {
      add(diagnostics, "error", "invalid-face", "Each face must contain at least three vertex indices.", `faces_vertices[${faceIndex}]`);
      return;
    }

    const local = new Set<number>();
    face.forEach((vertexIndex, index) => {
      if (!Number.isInteger(vertexIndex) || (vertexIndex as number) < 0 || (vertexIndex as number) >= vertices.length) {
        add(diagnostics, "error", "face-index-out-of-range", "Face references a vertex that does not exist.", `faces_vertices[${faceIndex}][${index}]`);
      }
      if (typeof vertexIndex === "number") {
        if (local.has(vertexIndex)) {
          add(diagnostics, "warning", "duplicate-face-vertex", "Face contains the same vertex more than once.", `faces_vertices[${faceIndex}]`);
        }
        local.add(vertexIndex);
      }
    });
  });

  const errors = diagnostics.filter(({ severity }) => severity === "error");
  const warnings = diagnostics.filter(({ severity }) => severity === "warning");
  return { valid: errors.length === 0, errors, warnings, diagnostics };
}
