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
  onSelectEdge(index: number, parameter: number): void;
  onSelectVertex(index: number): void;
}

export class PatternView {
  private graph: NormalizedFoldGraph | undefined;
  private selectedEdge = -1;
  private pendingVertex = -1;
  private tool: "select" | "crease" = "select";
  private gridSpacing = 0;
  private gridVisible = false;

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

  setGrid(spacing: number, visible: boolean): void {
    this.gridSpacing = Number.isFinite(spacing) && spacing > 0 ? spacing : 0;
    this.gridVisible = visible;
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

    if (this.gridVisible && this.gridSpacing > 0) {
      renderGrid(svg, bounds, padding, this.gridSpacing);
    }

    const vertexRadius = span * 0.0085;
    const vertexHitRadius = span * 0.026;
    const auxiliary = Array.isArray(graph.edges_origamiLabAuxiliary)
      ? graph.edges_origamiLabAuxiliary as boolean[]
      : [];

    edges.forEach((edge, index) => {
      const a = points[edge[0]];
      const b = points[edge[1]];
      if (!a || !b) return;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(a[0]));
      line.setAttribute("y1", String(a[1]));
      line.setAttribute("x2", String(b[0]));
      line.setAttribute("y2", String(b[1]));
      const isAuxiliary = auxiliary[index] === true;
      line.setAttribute("stroke", isAuxiliary ? "#9d9b94" : COLORS[graph.edges_assignment[index] ?? "U"]);
      line.setAttribute("stroke-width", index === this.selectedEdge ? "5" : isAuxiliary ? "1" : "2");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("vector-effect", "non-scaling-stroke");
      if (isAuxiliary) {
        line.setAttribute("stroke-dasharray", "3 5");
        line.setAttribute("opacity", "0.24");
      }
      line.classList.add("pattern-edge");
      if (isAuxiliary) line.classList.add("auxiliary");
      line.dataset.index = String(index);
      line.setAttribute("role", "button");
      line.setAttribute("tabindex", "0");
      line.setAttribute("aria-label", `Edge ${index}`);
      if (index === this.selectedEdge) line.classList.add("selected");
      const select = (event: Event) => {
        event.stopPropagation();
        this.options.onSelectEdge(index, edgeParameter(event, svg, a, b));
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
      const select = (event: Event) => {
        event.stopPropagation();
        this.options.onSelectVertex(index);
      };

      const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      hit.setAttribute("cx", String(x));
      hit.setAttribute("cy", String(y));
      hit.setAttribute("r", String(vertexHitRadius));
      hit.setAttribute("fill", "none");
      hit.setAttribute("stroke", "none");
      hit.setAttribute("pointer-events", "all");
      hit.classList.add("pattern-vertex-hit");
      hit.dataset.index = String(index);
      hit.setAttribute("aria-hidden", "true");
      hit.addEventListener("click", select);
      svg.append(hit);

      const point = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      point.setAttribute("cx", String(x));
      point.setAttribute("cy", String(y));
      point.setAttribute("r", String(vertexRadius));
      point.setAttribute("fill", index === this.pendingVertex ? "#ff593d" : "#111111");
      point.setAttribute("stroke", index === this.pendingVertex ? "#ffffff" : "transparent");
      point.setAttribute("stroke-width", index === this.pendingVertex ? "2" : "0");
      point.setAttribute("vector-effect", "non-scaling-stroke");
      point.classList.add("pattern-vertex");
      point.dataset.index = String(index);
      point.setAttribute("role", "button");
      point.setAttribute("tabindex", "0");
      point.setAttribute("aria-label", `Vertex ${index}`);
      if (index === this.pendingVertex) point.classList.add("pending");
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

function renderGrid(
  svg: SVGSVGElement,
  bounds: ReturnType<typeof calculateBounds>,
  padding: number,
  spacing: number,
): void {
  const minX = bounds.minX - padding;
  const maxX = bounds.minX + bounds.width + padding;
  const minY = bounds.minY - padding;
  const maxY = bounds.minY + bounds.height + padding;
  const firstX = Math.ceil(minX / spacing) * spacing;
  const firstY = Math.ceil(minY / spacing) * spacing;
  const verticalCount = Math.floor((maxX - firstX) / spacing) + 1;
  const horizontalCount = Math.floor((maxY - firstY) / spacing) + 1;
  if (verticalCount + horizontalCount > 240) return;

  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.classList.add("pattern-grid");
  group.setAttribute("pointer-events", "none");
  group.setAttribute("opacity", "0.16");
  for (let x = firstX; x <= maxX + spacing * 1e-6; x += spacing) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(x));
    line.setAttribute("y1", String(minY));
    line.setAttribute("x2", String(x));
    line.setAttribute("y2", String(maxY));
    line.setAttribute("stroke", "#77756f");
    line.setAttribute("stroke-width", "1");
    line.setAttribute("vector-effect", "non-scaling-stroke");
    group.append(line);
  }
  for (let y = firstY; y <= maxY + spacing * 1e-6; y += spacing) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(minX));
    line.setAttribute("y1", String(y));
    line.setAttribute("x2", String(maxX));
    line.setAttribute("y2", String(y));
    line.setAttribute("stroke", "#77756f");
    line.setAttribute("stroke-width", "1");
    line.setAttribute("vector-effect", "non-scaling-stroke");
    group.append(line);
  }
  svg.append(group);
}

function edgeParameter(
  event: Event,
  svg: SVGSVGElement,
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  if (!(event instanceof MouseEvent)) return 0.5;
  const matrix = svg.getScreenCTM();
  if (!matrix) return 0.5;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) return 0.5;
  const parameter = ((point.x - a[0]) * dx + (point.y - a[1]) * dy) / lengthSquared;
  return Math.max(0.01, Math.min(0.99, parameter));
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
