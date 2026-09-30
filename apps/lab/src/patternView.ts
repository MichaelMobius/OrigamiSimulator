import {
  projectVertices2D,
  type EdgeAssignment,
  type NormalizedFoldGraph,
} from "../../../packages/core/src/index";

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
  onSelectEdge(index: number): void;
  onSelectVertex(index: number): void;
}

export class PatternView {
  private graph: NormalizedFoldGraph | undefined;
  private selectedEdge = -1;
  private pendingVertex = -1;
  private tool: "select" | "crease" = "select";

  constructor(private readonly options: PatternViewOptions) {}

  setGraph(graph: NormalizedFoldGraph): void {
    this.graph = graph;
    if (this.selectedEdge >= graph.edges_vertices.length) this.selectedEdge = -1;
    if (this.pendingVertex >= (graph.vertices_coords?.length ?? 0)) this.pendingVertex = -1;
    this.render();
  }

  selectEdge(index: number): void {
    this.selectedEdge = index;
    this.render();
  }

  setInteraction(tool: "select" | "crease", pendingVertex: number): void {
    this.tool = tool;
    this.pendingVertex = pendingVertex;
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

    svg.dataset.tool = this.tool;
    const points = projectVertices2D(vertices);
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
      line.setAttribute("stroke-width", index === this.selectedEdge ? "5" : "2");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("vector-effect", "non-scaling-stroke");
      line.classList.add("pattern-edge");
      line.dataset.index = String(index);
      line.setAttribute("role", "button");
      line.setAttribute("tabindex", "0");
      line.setAttribute("aria-label", `Edge ${index}`);
      if (index === this.selectedEdge) line.classList.add("selected");
      const select = (event: Event) => {
        event.stopPropagation();
        this.options.onSelectEdge(index);
      };
      line.addEventListener("click", select);
      line.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select(event);
        }
      });
      svg.append(line);
    });

    points.forEach(([x, y], index) => {
      const point = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      point.setAttribute("cx", String(x));
      point.setAttribute("cy", String(y));
      point.setAttribute("r", String(vertexRadius));
      point.setAttribute("fill", index === this.pendingVertex ? "#ff593d" : "#111111");
      point.setAttribute("stroke", "transparent");
      point.setAttribute("stroke-width", "12");
      point.setAttribute("vector-effect", "non-scaling-stroke");
      point.classList.add("pattern-vertex");
      point.dataset.index = String(index);
      point.setAttribute("role", "button");
      point.setAttribute("tabindex", "0");
      point.setAttribute("aria-label", `Vertex ${index}`);
      if (index === this.pendingVertex) point.classList.add("pending");
      const select = (event: Event) => {
        event.stopPropagation();
        this.options.onSelectVertex(index);
      };
      point.addEventListener("click", select);
      point.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select(event);
        }
      });
      svg.append(point);
    });
  }
}

export function assignmentColor(assignment: EdgeAssignment): string {
  return COLORS[assignment];
}

function calculateBounds(points: ReadonlyArray<readonly [number, number]>) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}
