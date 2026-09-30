import { edgeKey, faceSignedArea, isSimpleFace } from "../geometry/planar.js";
import type {
  FoldDiagnostic,
  FoldGraph,
  FoldValidationResult,
} from "./types.js";
import { validateFoldGraph } from "./validate.js";

function add(
  diagnostics: FoldDiagnostic[],
  severity: "error" | "warning",
  code: string,
  message: string,
  path?: string,
): void {
  diagnostics.push(path === undefined ? { severity, code, message } : { severity, code, message, path });
}

/**
 * Stricter than generic FOLD validation: this checks the invariants required by
 * the legacy numerical solver before a graph is allowed to reach WebGL.
 */
export function validateFoldForSimulation(graph: FoldGraph): FoldValidationResult {
  const generic = validateFoldGraph(graph);
  const diagnostics = [...generic.diagnostics];
  const vertices = graph.vertices_coords ?? [];
  const edges = graph.edges_vertices ?? [];
  const assignments = graph.edges_assignment ?? [];
  const angles = graph.edges_foldAngle ?? [];
  const faces = graph.faces_vertices ?? [];

  if (edges.length === 0) {
    add(diagnostics, "error", "simulation-missing-edges", "Simulation requires at least one edge.", "edges_vertices");
  }
  if (faces.length === 0) {
    add(diagnostics, "error", "simulation-missing-faces", "Simulation requires at least one face.", "faces_vertices");
  }
  if (assignments.length !== edges.length) {
    add(diagnostics, "error", "simulation-assignment-length", "Simulation requires one assignment per edge.", "edges_assignment");
  }
  if (angles.length !== edges.length) {
    add(diagnostics, "error", "simulation-angle-length", "Simulation requires one fold angle per edge.", "edges_foldAngle");
  }

  const edgeMap = new Map<string, number>();
  edges.forEach((edge, index) => {
    const [a, b] = edge;
    const key = edgeKey(a, b);
    if (edgeMap.has(key)) {
      add(diagnostics, "error", "simulation-duplicate-edge", "Duplicate edges are not supported by the solver.", `edges_vertices[${index}]`);
    } else {
      edgeMap.set(key, index);
    }
  });

  const incidence = Array.from({ length: edges.length }, () => 0);
  faces.forEach((face, faceIndex) => {
    if (face.length < 3) return;
    if (!isSimpleFace(face, vertices)) {
      add(
        diagnostics,
        "error",
        "simulation-nonsimple-face",
        "Faces must be simple, non-self-intersecting polygons with non-zero area.",
        `faces_vertices[${faceIndex}]`,
      );
    } else if (Math.abs(faceSignedArea(face, vertices)) <= 1e-9) {
      add(diagnostics, "error", "simulation-zero-area-face", "Face area must be non-zero.", `faces_vertices[${faceIndex}]`);
    }

    face.forEach((vertex, localIndex) => {
      const next = face[(localIndex + 1) % face.length];
      if (next === undefined) return;
      const edgeIndex = edgeMap.get(edgeKey(vertex, next));
      if (edgeIndex === undefined) {
        add(
          diagnostics,
          "error",
          "simulation-missing-face-edge",
          `Face boundary ${vertex}-${next} has no matching edge.`,
          `faces_vertices[${faceIndex}]`,
        );
      } else {
        incidence[edgeIndex] = (incidence[edgeIndex] ?? 0) + 1;
      }
    });
  });

  angles.forEach((angle, index) => {
    if (typeof angle === "number" && (angle < -180 || angle > 180)) {
      add(
        diagnostics,
        "error",
        "simulation-angle-range",
        "Legacy simulation fold angles must be between -180° and 180°.",
        `edges_foldAngle[${index}]`,
      );
    }
  });

  assignments.forEach((assignment, index) => {
    const count = incidence[index] ?? 0;
    if (assignment === "J") {
      add(
        diagnostics,
        "error",
        "simulation-unsupported-assignment",
        "Join (J) edges are valid FOLD metadata but are not supported by the legacy WebGL solver.",
        `edges_assignment[${index}]`,
      );
    }
    if (assignment === "B" && count !== 1) {
      add(
        diagnostics,
        "error",
        "simulation-boundary-incidence",
        "Boundary edges must belong to exactly one face.",
        `edges_assignment[${index}]`,
      );
    }
    if ((assignment === "M" || assignment === "V" || assignment === "F") && count !== 2) {
      add(
        diagnostics,
        "error",
        "simulation-crease-incidence",
        `${assignment} edges must be shared by exactly two faces for simulation.`,
        `edges_assignment[${index}]`,
      );
    }
  });

  const errors = diagnostics.filter(({ severity }) => severity === "error");
  const warnings = diagnostics.filter(({ severity }) => severity === "warning");
  return { valid: errors.length === 0, errors, warnings, diagnostics };
}
