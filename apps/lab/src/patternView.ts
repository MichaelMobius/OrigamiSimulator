import type { EdgeAssignment, NormalizedFoldGraph } from "../../../packages/core/src/index";

const COLORS: Record<EdgeAssignment, string> = {
  B: "#8f8e88",
  M: "#ff4d63",
  V: "#4b7dff",
  F: "#f2c94c",
  U: "#d56cff",
  J: "#5ee1c4",
  C: "#4bd078",
};

export interface PatternViewOptions {
  svg: SVGSVGElement;
  empty: HTMLElement;
  onSelect(index: number): void;
}

export class PatternView {
  private graph: NormalizedFoldGraph | undefined;
  private selected = -1;

  constructor(private readonly options: PatternViewOptions) {}

  setGraph(graph: NormalizedFoldGraph): void {
    this.graph = graph;
    if (this.selected >= graph.edges_vertices.length) this.selected = -1;
    this.render();
  }

  select(index: number): void {
    this.selected = index;
    this.render();
  }

  private render(): void {
    const { svg, empty } = this.options;
    svg.replaceChildren();
    const graph = this.graph;
    const vertices = graph?.vertices_coords ?? [];
    const edges = graph?.edges_vertices ?? [];
    empty.hidden = vertices.length > 0;
    if (!graph || vertices.length === 0) return;

    const points = vertices.map(projectVertex);
    const bounds = calculateBounds(points);
    const span = Math.max(bounds.width, bounds.height, 1);
    const padding = span * 0.12;
    svg.setAttribute(
      "viewBox",
      `${bounds.minX - padding} ${bounds.minY - padding} ${bounds.width + 2 * padding} ${bounds.height + 2 * padding}`,
    );

    const vertexRadius = span * 0.0128;
    edges.forEach((edge, index) => {
      const a = points[edge[0]];
      const b = points[edge[1]];
      if (!a || !b) return;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(a[0]));
      line.setAttribute("y1", String(a[1]));
      line.setAttribute("x2", String(b[0]));
      line.setAttribute("y2", String(b[1]));
      line.setAttribute("stroke", COLORS[graph.edges_assignment[index] ?? "U"]);
      // non-scaling-stroke keeps these values in screen-space, so use an
      // explicit readable width instead of a model-coordinate-derived width.
      line.setAttribute("stroke-width", index === this.selected ? "5" : "2");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("vector-effect", "non-scaling-stroke");
      line.classList.add("pattern-edge");
      if (index === this.selected) line.classList.add("selected");
      line.addEventListener("click", (event) => {
        event.stopPropagation();
        this.options.onSelect(index);
      });
      svg.append(line);
    });

    points.forEach(([x, y]) => {
      const point = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      point.setAttribute("cx", String(x));
      point.setAttribute("cy", String(y));
      point.setAttribute("r", String(vertexRadius));
      point.setAttribute("fill", "#111111");
      point.classList.add("pattern-vertex");
      svg.append(point);
    });
  }
}

export function assignmentColor(assignment: EdgeAssignment): string {
  return COLORS[assignment];
}

function projectVertex(vertex: readonly number[]): [number, number] {
  return [vertex[0] ?? 0, vertex.length >= 3 ? vertex[2] ?? 0 : vertex[1] ?? 0];
}

function calculateBounds(points: Array<[number, number]>) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}
