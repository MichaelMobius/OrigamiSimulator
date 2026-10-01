import {
  projectVertices2D,
  type EdgeAssignment,
  type NormalizedFoldGraph,
  type Vec2,
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
  onMoveVertex?(index: number, point: Vec2): void;
  onPointerPosition?(point: Vec2 | undefined): void;
}

export class PatternView {
  private graph: NormalizedFoldGraph | undefined;
  private selectedEdge = -1;
  private pendingVertex = -1;
  private tool: "select" | "crease" = "select";
  private gridSpacing = 0;
  private gridVisible = false;
  private dragVertex = -1;
  private dragPreview: Vec2 | undefined;
  private dragMoved = false;
  private suppressClickUntil = 0;

  constructor(private readonly options: PatternViewOptions) {
    options.svg.addEventListener("pointermove", (event) => this.handlePointerMove(event));
    options.svg.addEventListener("pointerleave", () => {
      if (this.dragVertex < 0) this.options.onPointerPosition?.(undefined);
    });
    window.addEventListener("pointerup", (event) => this.finishDrag(event));
    window.addEventListener("pointercancel", () => this.cancelDrag());
  }

  setGraph(graph: NormalizedFoldGraph): void {
    this.graph = graph;
    if (this.selectedEdge >= graph.edges_vertices.length) this.selectedEdge = -1;
    if (this.pendingVertex >= (graph.vertices_coords?.length ?? 0)) this.pendingVertex = -1;
    if (this.dragVertex >= (graph.vertices_coords?.length ?? 0)) this.cancelDrag();
    this.render();
  }

  selectEdge(index: number): void {
    this.selectedEdge = index;
    this.render();
  }

  setInteraction(tool: "select" | "crease", pendingVertex: number): void {
    this.tool = tool;
    this.pendingVertex = pendingVertex;
    if (tool !== "select" && this.dragVertex >= 0) this.cancelDrag();
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
    if (this.dragVertex >= 0 && this.dragPreview) points[this.dragVertex] = this.dragPreview;
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
        if (performance.now() < this.suppressClickUntil) return;
        this.options.onSelectVertex(index);
      };
      const beginDrag = (event: PointerEvent) => {
        if (this.tool !== "select" || !this.options.onMoveVertex) return;
        event.preventDefault();
        event.stopPropagation();
        this.dragVertex = index;
        this.dragPreview = [x, y];
        this.dragMoved = false;
        svg.dataset.draggingVertex = String(index);
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
      hit.addEventListener("pointerdown", beginDrag);
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
      if (index === this.dragVertex) point.classList.add("dragging");
      point.dataset.index = String(index);
      point.setAttribute("role", "button");
      point.setAttribute("tabindex", "0");
      point.setAttribute("aria-label", `Vertex ${index}`);
      if (index === this.pendingVertex) point.classList.add("pending");
      point.addEventListener("click", select);
      point.addEventListener("pointerdown", beginDrag);
      point.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select(event);
        }
      });
      svg.append(point);
    });
  }

  private handlePointerMove(event: PointerEvent): void {
    const point = eventToSvgPoint(event, this.options.svg);
    if (!point) return;
    this.options.onPointerPosition?.(point);
    if (this.dragVertex < 0) return;
    if (!this.dragPreview || squaredDistance(this.dragPreview, point) > 1e-12) this.dragMoved = true;
    this.dragPreview = point;
    this.render();
  }

  private finishDrag(event: PointerEvent): void {
    if (this.dragVertex < 0) return;
    const index = this.dragVertex;
    const finalPoint = eventToSvgPoint(event, this.options.svg) ?? this.dragPreview;
    const moved = this.dragMoved;
    this.dragVertex = -1;
    this.dragPreview = undefined;
    this.dragMoved = false;
    delete this.options.svg.dataset.draggingVertex;
    if (moved && finalPoint) {
      this.suppressClickUntil = performance.now() + 250;
      this.options.onMoveVertex?.(index, finalPoint);
    } else {
      this.render();
    }
  }

  private cancelDrag(): void {
    this.dragVertex = -1;
    this.dragPreview = undefined;
    this.dragMoved = false;
    delete this.options.svg.dataset.draggingVertex;
    this.render();
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

function eventToSvgPoint(event: PointerEvent, svg: SVGSVGElement): Vec2 | undefined {
  const matrix = svg.getScreenCTM();
  if (!matrix) return undefined;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return [point.x, point.y];
}

function squaredDistance(a: Vec2, b: Vec2): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
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
