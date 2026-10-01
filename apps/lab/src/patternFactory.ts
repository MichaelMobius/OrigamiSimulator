import type { FoldGraph } from "../../../packages/core/src/index";

export interface RectangularPatternOptions {
  width: number;
  height: number;
  title?: string;
  units?: string;
}

export function createRectangularPattern(options: RectangularPatternOptions): FoldGraph {
  const width = finitePositive(options.width, "width");
  const height = finitePositive(options.height, "height");
  const title = options.title?.trim() || "Untitled pattern";

  return {
    file_spec: 1.1,
    file_creator: "Origami Lab",
    file_title: title,
    file_units: options.units ?? "mm",
    frame_title: title,
    frame_classes: ["creasePattern"],
    vertices_coords: [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ],
    edges_assignment: ["B", "B", "B", "B"],
    edges_foldAngle: [0, 0, 0, 0],
    faces_vertices: [[0, 1, 2, 3]],
  };
}

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Paper ${label} must be a positive finite number.`);
  }
  if (value > 10_000) {
    throw new Error(`Paper ${label} must not exceed 10000 mm.`);
  }
  return value;
}
