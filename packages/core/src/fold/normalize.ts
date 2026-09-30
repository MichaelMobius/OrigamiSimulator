import {
  SUPPORTED_EDGE_ASSIGNMENTS,
  type Edge,
  type EdgeAssignment,
  type FoldAngle,
  type FoldDiagnostic,
  type FoldGraph,
  type FoldNormalizationResult,
  type NormalizedFoldGraph,
  type Vertex,
} from "./types.js";

const ASSIGNMENTS = new Set<string>(SUPPORTED_EDGE_ASSIGNMENTS);

export function defaultFoldAngle(assignment: EdgeAssignment): number {
  if (assignment === "V") return 180;
  if (assignment === "M") return -180;
  return 0;
}

function normalizeAssignment(
  value: unknown,
  index: number,
  diagnostics: FoldDiagnostic[],
): EdgeAssignment {
  if (value === undefined || value === "") return "U";
  if (typeof value === "string" && ASSIGNMENTS.has(value)) return value as EdgeAssignment;

  diagnostics.push({
    severity: "warning",
    code: "unsupported-edge-assignment",
    message: `Unsupported edge assignment '${String(value)}' was replaced with 'U'.`,
    path: `edges_assignment[${index}]`,
  });
  return "U";
}

export function normalizeFoldGraph(input: FoldGraph): FoldNormalizationResult {
  const diagnostics: FoldDiagnostic[] = [];
  const raw = input as Record<string, unknown>;

  const rawVertices = Array.isArray(raw.vertices_coords) ? raw.vertices_coords : [];
  if (raw.vertices_coords !== undefined && !Array.isArray(raw.vertices_coords)) {
    diagnostics.push({
      severity: "error",
      code: "invalid-vertices-array",
      message: "vertices_coords must be an array.",
      path: "vertices_coords",
    });
  }
  const vertices: Vertex[] = rawVertices.map((vertex, index) => {
    if (!Array.isArray(vertex)) {
      diagnostics.push({
        severity: "error",
        code: "invalid-vertex",
        message: "Each vertex must be an array of coordinates.",
        path: `vertices_coords[${index}]`,
      });
      return [];
    }
    return vertex.map((value) => typeof value === "number" ? value : Number.NaN);
  });

  const rawEdges = Array.isArray(raw.edges_vertices) ? raw.edges_vertices : [];
  if (raw.edges_vertices !== undefined && !Array.isArray(raw.edges_vertices)) {
    diagnostics.push({
      severity: "error",
      code: "invalid-edges-array",
      message: "edges_vertices must be an array.",
      path: "edges_vertices",
    });
  }
  const edges: Edge[] = rawEdges.map((edge, index) => {
    if (!Array.isArray(edge) || edge.length !== 2) {
      diagnostics.push({
        severity: "error",
        code: "invalid-edge",
        message: "Each edge must contain exactly two vertex indices.",
        path: `edges_vertices[${index}]`,
      });
      return [Number.NaN, Number.NaN];
    }
    return [
      typeof edge[0] === "number" ? edge[0] : Number.NaN,
      typeof edge[1] === "number" ? edge[1] : Number.NaN,
    ];
  });

  const rawAssignments = Array.isArray(raw.edges_assignment) ? raw.edges_assignment : [];
  if (raw.edges_assignment !== undefined && !Array.isArray(raw.edges_assignment)) {
    diagnostics.push({
      severity: "error",
      code: "invalid-assignments-array",
      message: "edges_assignment must be an array.",
      path: "edges_assignment",
    });
  }

  const rawAngles = Array.isArray(raw.edges_foldAngle) ? raw.edges_foldAngle : undefined;
  if (raw.edges_foldAngle !== undefined && !Array.isArray(raw.edges_foldAngle)) {
    diagnostics.push({
      severity: "error",
      code: "invalid-fold-angles-array",
      message: "edges_foldAngle must be an array.",
      path: "edges_foldAngle",
    });
  }

  const count = edges.length;
  if (rawAssignments.length > count) {
    diagnostics.push({
      severity: "warning",
      code: "orphan-edge-assignments",
      message: "Extra edge assignments without matching edges were discarded.",
      path: "edges_assignment",
    });
  }
  if ((rawAngles?.length ?? 0) > count) {
    diagnostics.push({
      severity: "warning",
      code: "orphan-fold-angles",
      message: "Extra fold angles without matching edges were discarded.",
      path: "edges_foldAngle",
    });
  }

  const assignments: EdgeAssignment[] = [];
  const angles: FoldAngle[] = [];
  for (let index = 0; index < count; index += 1) {
    const assignment = normalizeAssignment(rawAssignments[index], index, diagnostics);
    assignments.push(assignment);
    const angle = rawAngles?.[index];
    if (angle === undefined) {
      angles.push(defaultFoldAngle(assignment));
    } else if (angle === null || typeof angle === "number") {
      angles.push(angle);
    } else {
      diagnostics.push({
        severity: "error",
        code: "invalid-fold-angle",
        message: "Fold angle must be a finite number or null.",
        path: `edges_foldAngle[${index}]`,
      });
      angles.push(Number.NaN);
    }
  }

  if (rawAngles === undefined && count > 0) {
    diagnostics.push({
      severity: "warning",
      code: "missing-fold-angles",
      message: "edges_foldAngle was missing; target angles were inferred from edge assignments.",
      path: "edges_foldAngle",
    });
  } else if ((rawAngles?.length ?? 0) < count) {
    diagnostics.push({
      severity: "warning",
      code: "missing-fold-angles",
      message: "Missing fold angles were inferred from edge assignments.",
      path: "edges_foldAngle",
    });
  }

  if (rawAssignments.length < count) {
    diagnostics.push({
      severity: "warning",
      code: "missing-edge-assignments",
      message: "Missing edge assignments were filled with 'U'.",
      path: "edges_assignment",
    });
  }

  let faces: number[][] | undefined;
  if (raw.faces_vertices !== undefined) {
    if (!Array.isArray(raw.faces_vertices)) {
      diagnostics.push({
        severity: "error",
        code: "invalid-faces-array",
        message: "faces_vertices must be an array.",
        path: "faces_vertices",
      });
      faces = [];
    } else {
      faces = raw.faces_vertices.map((face, index) => {
        if (!Array.isArray(face)) {
          diagnostics.push({
            severity: "error",
            code: "invalid-face",
            message: "Each face must be an array of vertex indices.",
            path: `faces_vertices[${index}]`,
          });
          return [];
        }
        return face.map((value) => typeof value === "number" ? value : Number.NaN);
      });
    }
  }

  const graph: NormalizedFoldGraph = {
    ...input,
    vertices_coords: vertices,
    edges_vertices: edges,
    edges_assignment: assignments,
    edges_foldAngle: angles,
  };
  if (faces !== undefined) graph.faces_vertices = faces;

  return { graph, diagnostics };
}
