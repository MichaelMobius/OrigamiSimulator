import {
  LegacyWebGLSolverAdapter,
  normalizeFoldGraph,
  projectVertices2D,
  validateFoldForSimulation,
  type EdgeAssignment,
  type FoldDiagnostic,
  type FoldGraph,
  type NormalizedFoldGraph,
  type SimulationFrame,
  type Vec2,
} from "../../../packages/core/src/index";
import {
  findContainingFace,
  insertInteriorVertex,
  snapPointToGraph,
  traceCreaseBetweenVertices,
} from "./cadDrawing";
import {
  deleteInternalCrease,
  GeometryEditError,
  GraphHistory,
} from "./geometryEditor";
import { splitEdgeAt } from "./edgeSplit";
import { IframeLegacyRuntime } from "./legacyRuntime";
import { PatternView } from "./patternView";
import {
  angularSnapPoint,
  edgeMeasurement,
  findMidpointSnap,
  mirrorPattern,
  moveVertexSafely,
  pointMeasurement,
  snapMovePointToGrid,
} from "./precisionCad";
import { OrigamiScene } from "./scene3d";

const EXAMPLE: FoldGraph = {
  file_spec: 1.1,
  file_creator: "Origami Lab",
  frame_title: "Single hinge",
  vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1]],
  edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]],
  edges_assignment: ["B", "B", "B", "B", "V"],
  edges_foldAngle: [0, 0, 0, 0, 90],
  faces_vertices: [[0, 1, 2], [0, 2, 3]],
};

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_VERTICES = 100_000;
const MAX_EDGES = 200_000;
const MAX_FACES = 100_000;

type EditorTool = "select" | "crease";

const elements = {
  svg: required<SVGSVGElement>("pattern-svg"),
  patternStage: required<HTMLElement>("pattern-stage"),
  empty: required<HTMLElement>("pattern-empty"),
  runtimeStatus: required<HTMLElement>("runtime-status"),
  threeStage: required<HTMLElement>("three-stage"),
  foldPercent: required<HTMLInputElement>("fold-percent"),
  foldPercentOutput: required<HTMLOutputElement>("fold-percent-output"),
  simulate: required<HTMLButtonElement>("simulate-button"),
  metric: required<HTMLElement>("frame-metric"),
  selectionEmpty: required<HTMLElement>("selection-empty"),
  edgeControls: required<HTMLElement>("edge-controls"),
  edgeIndex: required<HTMLElement>("edge-index"),
  edgeAssignment: required<HTMLSelectElement>("edge-assignment"),
  edgeAngle: required<HTMLInputElement>("edge-angle"),
  edgeMetrics: required<HTMLElement>("edge-metrics"),
  deleteEdge: required<HTMLButtonElement>("delete-edge-button"),
  diagnostics: required<HTMLElement>("diagnostics"),
  validationBadge: required<HTMLElement>("validation-badge"),
  modelStats: required<HTMLElement>("model-stats"),
  resetExample: required<HTMLButtonElement>("reset-example"),
  importButton: required<HTMLButtonElement>("import-button"),
  exportButton: required<HTMLButtonElement>("export-button"),
  undoButton: required<HTMLButtonElement>("undo-button"),
  redoButton: required<HTMLButtonElement>("redo-button"),
  selectTool: required<HTMLButtonElement>("select-tool"),
  creaseTool: required<HTMLButtonElement>("crease-tool"),
  snapToggle: required<HTMLButtonElement>("snap-toggle"),
  gridSize: required<HTMLInputElement>("grid-size"),
  precisionReadout: required<HTMLElement>("precision-readout"),
  mirrorVertical: required<HTMLButtonElement>("mirror-vertical"),
  mirrorHorizontal: required<HTMLButtonElement>("mirror-horizontal"),
  toolHint: required<HTMLElement>("tool-hint"),
  fileInput: required<HTMLInputElement>("file-input"),
  legacyIframe: required<HTMLIFrameElement>("legacy-runtime"),
};

let graph = normalizeFoldGraph(structuredClone(EXAMPLE)).graph;
let selectedEdge = -1;
let activeTool: EditorTool = "select";
let pendingVertex = -1;
let snapEnabled = true;
let lastPointerPoint: Vec2 | undefined;
let sourceDiagnostics: FoldDiagnostic[] = [];
let editorDiagnostics: FoldDiagnostic[] = [];
let runtimeReady = false;

const history = new GraphHistory();
const runtime = new IframeLegacyRuntime(elements.legacyIframe);
const solver = new LegacyWebGLSolverAdapter(runtime, { defaultIterations: 200, chunkSize: 50 });
const scene = new OrigamiScene(elements.threeStage);
const pattern = new PatternView({
  svg: elements.svg,
  empty: elements.empty,
  onSelectEdge: handleEdgeSelect,
  onSelectVertex: handleVertexSelect,
  onMoveVertex: handleVertexMove,
  onPointerPosition: handlePointerPosition,
});

elements.svg.addEventListener("click", (event) => handlePatternBackgroundClick(event));
elements.foldPercent.addEventListener("input", updateFoldPercentLabel);
elements.simulate.addEventListener("click", () => void simulate());
elements.edgeAssignment.addEventListener("change", updateSelectedAssignment);
elements.edgeAngle.addEventListener("change", updateSelectedAngle);
elements.deleteEdge.addEventListener("click", deleteSelectedEdge);
elements.resetExample.addEventListener("click", () => loadGraph(EXAMPLE));
elements.importButton.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", () => void importFile());
elements.exportButton.addEventListener("click", exportFold);
elements.undoButton.addEventListener("click", undo);
elements.redoButton.addEventListener("click", redo);
elements.selectTool.addEventListener("click", () => setTool("select"));
elements.creaseTool.addEventListener("click", () => setTool("crease"));
elements.snapToggle.addEventListener("click", toggleSnap);
elements.gridSize.addEventListener("input", renderToolState);
elements.mirrorVertical.addEventListener("click", () => mirrorWholePattern("vertical"));
elements.mirrorHorizontal.addEventListener("click", () => mirrorWholePattern("horizontal"));
document.addEventListener("keydown", handleKeyboardShortcut);

loadGraph(EXAMPLE);
void initializeRuntime();

async function initializeRuntime(): Promise<void> {
  try {
    await runtime.ready();
    runtimeReady = true;
    elements.runtimeStatus.textContent = "Legacy solver ready";
    elements.runtimeStatus.className = "runtime-status ready";
    renderDiagnostics();
  } catch (error) {
    runtimeReady = false;
    elements.runtimeStatus.textContent = "Solver unavailable";
    elements.runtimeStatus.className = "runtime-status error";
    addEditorDiagnostic(error, "runtime");
  }
}

function loadGraph(input: FoldGraph): void {
  assertComplexity(input);
  const normalized = normalizeFoldGraph(structuredClone(input));
  graph = normalized.graph;
  sourceDiagnostics = normalized.diagnostics;
  editorDiagnostics = [];
  selectedEdge = -1;
  pendingVertex = -1;
  lastPointerPoint = undefined;
  activeTool = "select";
  history.clear();
  autoGridForGraph();
  renderAll();
}

function renderAll(): void {
  pattern.setGraph(graph);
  pattern.selectEdge(selectedEdge);
  scene.setGraph(graph);
  renderSelection();
  renderDiagnostics();
  renderStats();
  renderToolState();
  renderHistory();
  renderPrecisionReadout(lastPointerPoint);
  elements.metric.textContent = "flat preview";
}

function renderGraphState(): void {
  pattern.setGraph(graph);
  pattern.selectEdge(selectedEdge);
  scene.setGraph(graph);
  renderSelection();
  renderDiagnostics();
  renderStats();
  renderToolState();
  renderHistory();
  renderPrecisionReadout(lastPointerPoint);
  elements.metric.textContent = "flat preview";
}

function handlePatternBackgroundClick(event: MouseEvent): void {
  if (activeTool === "select") {
    selectEdge(-1);
    return;
  }
  const point = eventPointInSvg(event);
  if (!point) return;
  handleCadPoint(point);
}

function handleCadPoint(rawPoint: Vec2): void {
  try {
    let precisionPoint = rawPoint;
    if (pendingVertex >= 0 && snapEnabled) {
      precisionPoint = angularSnapPoint(graph, pendingVertex, rawPoint).point;
    }

    if (snapEnabled) {
      const midpoint = findMidpointSnap(graph, precisionPoint, snapTolerance() * 0.72);
      if (midpoint) {
        handleEdgeSelect(midpoint.edgeIndex, midpoint.parameter);
        return;
      }
    }

    const snap = snapPointToGraph(graph, precisionPoint, {
      tolerance: snapEnabled ? snapTolerance() : 0,
      gridEnabled: snapEnabled,
      gridSize: currentGridSize(),
    });
    if (snap.kind === "vertex") {
      handleVertexSelect(snap.vertexIndex);
      return;
    }
    if (snap.kind === "edge") {
      handleEdgeSelect(snap.edgeIndex, snap.parameter);
      return;
    }

    const faceIndex = findContainingFace(graph, snap.point);
    const inserted = insertInteriorVertex(graph, faceIndex, snap.point);
    if (pendingVertex < 0) {
      applyGraphEdit(
        inserted.graph,
        "Insert free point",
        -1,
        inserted.droppedOrderMetadata ? topologyMetadataDiagnostic() : undefined,
        inserted.vertexIndex,
      );
      return;
    }

    const firstVertex = pendingVertex;
    const traced = traceCreaseBetweenVertices(inserted.graph, firstVertex, inserted.vertexIndex, "V", 180);
    applyGraphEdit(
      traced.graph,
      "Draw free crease",
      traced.edgeIndices.at(-1) ?? -1,
      inserted.droppedOrderMetadata || traced.droppedOrderMetadata
        ? topologyMetadataDiagnostic()
        : undefined,
    );
  } catch (error) {
    addEditorDiagnostic(error, geometryCode(error));
    renderToolState();
  }
}

function handleEdgeSelect(index: number, parameter: number): void {
  if (activeTool !== "crease") {
    selectEdge(index);
    return;
  }

  const firstVertex = pendingVertex;
  try {
    const split = splitEdgeAt(graph, index, parameter);
    if (firstVertex < 0) {
      applyGraphEdit(
        split.graph,
        "Insert vertex",
        -1,
        split.droppedOrderMetadata ? topologyMetadataDiagnostic() : undefined,
        split.vertexIndex,
      );
      return;
    }

    const traced = traceCreaseBetweenVertices(split.graph, firstVertex, split.vertexIndex, "V", 180);
    applyGraphEdit(
      traced.graph,
      "Draw crease",
      traced.edgeIndices.at(-1) ?? -1,
      split.droppedOrderMetadata || traced.droppedOrderMetadata
        ? topologyMetadataDiagnostic()
        : undefined,
    );
  } catch (error) {
    addEditorDiagnostic(error, geometryCode(error));
    renderToolState();
  }
}

function handleVertexSelect(index: number): void {
  if (activeTool !== "crease") {
    selectEdge(-1);
    return;
  }

  selectEdge(-1);
  if (pendingVertex < 0) {
    pendingVertex = index;
    editorDiagnostics = [];
    renderToolState();
    renderDiagnostics();
    renderPrecisionReadout(lastPointerPoint);
    return;
  }

  if (pendingVertex === index) {
    pendingVertex = -1;
    renderToolState();
    renderPrecisionReadout(lastPointerPoint);
    return;
  }

  try {
    const result = traceCreaseBetweenVertices(graph, pendingVertex, index, "V", 180);
    applyGraphEdit(
      result.graph,
      "Draw crease",
      result.edgeIndices.at(-1) ?? -1,
      result.droppedOrderMetadata ? topologyMetadataDiagnostic() : undefined,
    );
  } catch (error) {
    addEditorDiagnostic(error, geometryCode(error));
    renderToolState();
  }
}

function handleVertexMove(index: number, rawPoint: Vec2): void {
  if (activeTool !== "select") return;
  try {
    const target = snapEnabled ? snapMovePointToGrid(rawPoint, currentGridSize()) : rawPoint;
    const next = moveVertexSafely(graph, index, target);
    applyGraphEdit(next, "Move vertex", -1);
    elements.toolHint.textContent = `Moved vertex ${index} to ${formatNumber(target[0])}, ${formatNumber(target[1])}.`;
  } catch (error) {
    addEditorDiagnostic(error, geometryCode(error));
    pattern.setGraph(graph);
  }
}

function handlePointerPosition(point: Vec2 | undefined): void {
  lastPointerPoint = point;
  renderPrecisionReadout(point);
}

function selectEdge(index: number): void {
  selectedEdge = index;
  pattern.selectEdge(index);
  renderSelection();
  renderPrecisionReadout(lastPointerPoint);
}

function setTool(tool: EditorTool): void {
  activeTool = tool;
  pendingVertex = -1;
  if (tool === "crease") selectedEdge = -1;
  pattern.selectEdge(selectedEdge);
  renderSelection();
  renderToolState();
  renderPrecisionReadout(lastPointerPoint);
}

function toggleSnap(): void {
  snapEnabled = !snapEnabled;
  renderToolState();
  renderPrecisionReadout(lastPointerPoint);
}

function renderToolState(): void {
  elements.selectTool.classList.toggle("active", activeTool === "select");
  elements.creaseTool.classList.toggle("active", activeTool === "crease");
  elements.snapToggle.classList.toggle("active", snapEnabled);
  elements.selectTool.setAttribute("aria-pressed", String(activeTool === "select"));
  elements.creaseTool.setAttribute("aria-pressed", String(activeTool === "crease"));
  elements.snapToggle.setAttribute("aria-pressed", String(snapEnabled));
  elements.patternStage.dataset.cadActive = String(activeTool === "crease");
  pattern.setInteraction(activeTool, pendingVertex);
  pattern.setGrid(currentGridSize(), activeTool === "crease" && snapEnabled);

  if (activeTool === "select") {
    elements.toolHint.textContent = "Select an edge to edit it, or drag a vertex to move it safely.";
  } else if (pendingVertex < 0) {
    elements.toolHint.textContent = "Crease CAD · click a vertex, edge, midpoint, or any free point to start.";
  } else {
    elements.toolHint.textContent = `Crease CAD · vertex ${pendingVertex} selected; 30°/45°/60°/90° guides and crossings snap automatically.`;
  }
}

function renderSelection(): void {
  const hasSelection = selectedEdge >= 0 && selectedEdge < graph.edges_vertices.length;
  elements.selectionEmpty.hidden = hasSelection;
  elements.edgeControls.hidden = !hasSelection;
  elements.deleteEdge.disabled = !hasSelection || !isInternalEdge(selectedEdge);
  if (!hasSelection) {
    elements.edgeMetrics.textContent = "";
    return;
  }

  elements.edgeIndex.textContent = String(selectedEdge);
  elements.edgeAssignment.value = graph.edges_assignment[selectedEdge] ?? "U";
  const angle = graph.edges_foldAngle[selectedEdge];
  elements.edgeAngle.value = String(typeof angle === "number" ? angle : 0);
  const measured = edgeMeasurement(graph, selectedEdge);
  elements.edgeMetrics.textContent = measured
    ? `Length ${formatLength(measured.length)} · planar angle ${formatAngle(measured.angleDegrees)}`
    : "";
}

function renderPrecisionReadout(point: Vec2 | undefined): void {
  if (!point) {
    elements.precisionReadout.textContent = selectedEdge >= 0
      ? elements.edgeMetrics.textContent || "Precision CAD"
      : "x — · y —";
    return;
  }

  const units = displayUnits();
  let label = `x ${formatNumber(point[0])}${units} · y ${formatNumber(point[1])}${units}`;
  if (pendingVertex >= 0) {
    const origin = projectVertices2D(graph.vertices_coords ?? [])[pendingVertex];
    if (origin) {
      const snapped = snapEnabled ? angularSnapPoint(graph, pendingVertex, point) : { point, angleDegrees: pointMeasurement(origin, point).angleDegrees, snapped: false };
      const measured = pointMeasurement(origin, snapped.point);
      label = `L ${formatNumber(measured.length)}${units} · θ ${formatAngle(measured.angleDegrees)} · x ${formatNumber(snapped.point[0])}${units} · y ${formatNumber(snapped.point[1])}${units}`;
      if (snapped.snapped) label += " · angle snap";
    }
  }
  elements.precisionReadout.textContent = label;
}

function updateSelectedAssignment(): void {
  if (selectedEdge < 0) return;
  const next = structuredClone(graph) as NormalizedFoldGraph;
  const assignment = elements.edgeAssignment.value as EdgeAssignment;
  next.edges_assignment[selectedEdge] = assignment;
  if (Array.isArray(next.edges_origamiLabAuxiliary)) next.edges_origamiLabAuxiliary[selectedEdge] = false;

  const current = next.edges_foldAngle[selectedEdge];
  if (assignment === "M" || assignment === "V") {
    const magnitude = typeof current === "number" && Number.isFinite(current) && Math.abs(current) > 0
      ? Math.min(180, Math.abs(current))
      : 180;
    next.edges_foldAngle[selectedEdge] = assignment === "M" ? -magnitude : magnitude;
  } else {
    next.edges_foldAngle[selectedEdge] = 0;
  }
  applyGraphEdit(next, "Change crease assignment", selectedEdge);
}

function updateSelectedAngle(): void {
  if (selectedEdge < 0) return;
  const value = Number(elements.edgeAngle.value);
  if (!Number.isFinite(value)) return;
  const next = structuredClone(graph) as NormalizedFoldGraph;
  next.edges_foldAngle[selectedEdge] = Math.max(-180, Math.min(180, value));
  applyGraphEdit(next, "Change crease angle", selectedEdge);
}

function deleteSelectedEdge(): void {
  if (selectedEdge < 0) return;
  try {
    const result = deleteInternalCrease(graph, selectedEdge);
    applyGraphEdit(
      result.graph,
      "Delete crease",
      -1,
      result.droppedOrderMetadata ? topologyMetadataDiagnostic() : undefined,
    );
  } catch (error) {
    addEditorDiagnostic(error, geometryCode(error));
  }
}

function mirrorWholePattern(axis: "horizontal" | "vertical"): void {
  try {
    const next = mirrorPattern(graph, axis);
    applyGraphEdit(next, axis === "vertical" ? "Mirror pattern left/right" : "Mirror pattern up/down", -1);
  } catch (error) {
    addEditorDiagnostic(error, geometryCode(error));
  }
}

function applyGraphEdit(
  next: NormalizedFoldGraph,
  label: string,
  nextSelectedEdge: number,
  diagnostic?: FoldDiagnostic,
  nextPendingVertex = -1,
): void {
  history.record(graph, label);
  graph = next;
  selectedEdge = nextSelectedEdge;
  pendingVertex = nextPendingVertex;
  sourceDiagnostics = [];
  editorDiagnostics = diagnostic ? [diagnostic] : [];
  renderGraphState();
}

function undo(): void {
  const result = history.undo(graph);
  if (!result) return;
  graph = result.graph;
  selectedEdge = -1;
  pendingVertex = -1;
  editorDiagnostics = [];
  sourceDiagnostics = [];
  renderGraphState();
  elements.toolHint.textContent = `Undid: ${result.label}`;
}

function redo(): void {
  const result = history.redo(graph);
  if (!result) return;
  graph = result.graph;
  selectedEdge = -1;
  pendingVertex = -1;
  editorDiagnostics = [];
  sourceDiagnostics = [];
  renderGraphState();
  elements.toolHint.textContent = `Redid: ${result.label}`;
}

function renderHistory(): void {
  elements.undoButton.disabled = !history.canUndo;
  elements.redoButton.disabled = !history.canRedo;
}

function handleKeyboardShortcut(event: KeyboardEvent): void {
  if (event.key === "Escape" && activeTool === "crease" && !isTextEditingTarget(event.target)) {
    pendingVertex = -1;
    renderToolState();
    renderPrecisionReadout(lastPointerPoint);
    return;
  }
  if (!(event.ctrlKey || event.metaKey) || isTextEditingTarget(event.target)) return;
  const key = event.key.toLowerCase();
  if (key === "z" && event.shiftKey) {
    event.preventDefault();
    redo();
  } else if (key === "z") {
    event.preventDefault();
    undo();
  } else if (key === "y") {
    event.preventDefault();
    redo();
  }
}

function renderDiagnostics(): void {
  const validation = validateFoldForSimulation(graph);
  const diagnostics = [...sourceDiagnostics, ...editorDiagnostics, ...validation.diagnostics];
  elements.diagnostics.replaceChildren();

  if (diagnostics.length === 0) {
    const item = document.createElement("div");
    item.className = "diagnostic ok";
    item.textContent = "No issues detected.";
    elements.diagnostics.append(item);
  } else {
    diagnostics.slice(0, 12).forEach((diagnostic) => {
      const item = document.createElement("div");
      item.className = `diagnostic ${diagnostic.severity}`;
      const code = document.createElement("code");
      code.textContent = diagnostic.code;
      const message = document.createElement("span");
      message.textContent = diagnostic.message;
      item.append(code, message);
      elements.diagnostics.append(item);
    });
  }

  const errors = diagnostics.filter(({ severity }) => severity === "error").length;
  const warnings = diagnostics.filter(({ severity }) => severity === "warning").length;
  elements.validationBadge.className = `badge ${errors > 0 ? "bad" : warnings > 0 ? "warn" : "good"}`;
  elements.validationBadge.textContent = errors > 0 ? `${errors} errors` : warnings > 0 ? `${warnings} warnings` : "valid";
  elements.simulate.disabled = errors > 0 || !runtimeReady;
}

function renderStats(): void {
  const auxiliary = Array.isArray(graph.edges_origamiLabAuxiliary)
    ? graph.edges_origamiLabAuxiliary.filter(Boolean).length
    : 0;
  const stats = [
    ["Vertices", graph.vertices_coords?.length ?? 0],
    ["Edges", graph.edges_vertices.length],
    ["Faces", graph.faces_vertices?.length ?? 0],
    ["Mountains", graph.edges_assignment.filter((value) => value === "M").length],
    ["Valleys", graph.edges_assignment.filter((value) => value === "V").length],
    ["CAD topology", auxiliary],
  ];
  elements.modelStats.replaceChildren();
  stats.forEach(([label, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = String(label);
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    elements.modelStats.append(dt, dd);
  });
}

async function simulate(): Promise<void> {
  const validation = validateFoldForSimulation(graph);
  if (!runtimeReady || !validation.valid || sourceDiagnostics.some(({ severity }) => severity === "error")) {
    renderDiagnostics();
    return;
  }

  elements.simulate.disabled = true;
  elements.simulate.textContent = "Solving…";
  elements.metric.textContent = "computing";
  try {
    const frame = await solver.simulate({
      graph,
      foldPercent: Number(elements.foldPercent.value) / 100,
      maxIterations: 200,
    });
    assertSimulationFrame(frame, graph.vertices_coords?.length ?? 0);
    scene.setGraph(graph, frame.verticesCoords);
    elements.metric.textContent = frame.residual === undefined
      ? `${frame.iteration} steps`
      : `${frame.residual.toFixed(5)}% error · ${frame.iteration} steps`;
  } catch (error) {
    addEditorDiagnostic(error, "runtime");
    elements.metric.textContent = "solver error";
  } finally {
    renderDiagnostics();
    elements.simulate.textContent = "Run solver";
  }
}

function updateFoldPercentLabel(): void {
  elements.foldPercentOutput.value = `${elements.foldPercent.value}%`;
}

async function importFile(): Promise<void> {
  const file = elements.fileInput.files?.[0];
  elements.fileInput.value = "";
  if (!file) return;
  try {
    if (file.size > MAX_IMPORT_BYTES) {
      throw new Error(`File is too large (${Math.ceil(file.size / 1024 / 1024)} MB). Maximum is 10 MB.`);
    }
    const parsed = JSON.parse(await file.text()) as FoldGraph;
    assertComplexity(parsed);
    loadGraph(parsed);
  } catch (error) {
    addEditorDiagnostic(new Error(`Unable to import ${file.name}: ${messageOf(error)}`), "import");
  }
}

function exportFold(): void {
  const blob = new Blob([`${JSON.stringify(graph, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "origami-lab.fold";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function assertComplexity(input: FoldGraph): void {
  const vertices = input.vertices_coords?.length ?? 0;
  const edges = input.edges_vertices?.length ?? 0;
  const faces = input.faces_vertices?.length ?? 0;
  if (vertices > MAX_VERTICES || edges > MAX_EDGES || faces > MAX_FACES) {
    throw new Error(
      `Model exceeds safety limits (${vertices} vertices, ${edges} edges, ${faces} faces).`,
    );
  }
}

function assertSimulationFrame(frame: SimulationFrame, expectedVertices: number): void {
  if (frame.verticesCoords.length !== expectedVertices) {
    throw new Error(
      `Solver returned ${frame.verticesCoords.length} vertices; expected ${expectedVertices}.`,
    );
  }
  frame.verticesCoords.forEach((vertex, index) => {
    if (vertex.length < 3 || !vertex.every(Number.isFinite)) {
      throw new Error(`Solver returned invalid coordinates for vertex ${index}.`);
    }
  });
  if (frame.residual !== undefined && !Number.isFinite(frame.residual)) {
    throw new Error("Solver returned a non-finite residual.");
  }
}

function topologyMetadataDiagnostic(): FoldDiagnostic {
  return {
    severity: "warning",
    code: "topology-order-metadata-dropped",
    message: "faceOrders/edgeOrders were removed because topology changed and their indices were no longer reliable.",
  };
}

function addEditorDiagnostic(error: unknown, code: string): void {
  editorDiagnostics = [{
    severity: "error",
    code,
    message: messageOf(error),
  }];
  renderDiagnostics();
}

function geometryCode(error: unknown): string {
  return error instanceof GeometryEditError ? error.code : "geometry-edit";
}

function isInternalEdge(index: number): boolean {
  const edge = graph.edges_vertices[index];
  if (!edge) return false;
  const [a, b] = edge;
  const faces = graph.faces_vertices ?? [];
  return faces.filter((face) => face.some((vertex, faceIndex) => {
    const next = face[(faceIndex + 1) % face.length];
    return (vertex === a && next === b) || (vertex === b && next === a);
  })).length === 2;
}

function eventPointInSvg(event: MouseEvent): Vec2 | undefined {
  const matrix = elements.svg.getScreenCTM();
  if (!matrix) return undefined;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return [point.x, point.y];
}

function snapTolerance(): number {
  const points = projectVertices2D(graph.vertices_coords ?? []);
  if (points.length === 0) return 1;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  return span * 0.022;
}

function currentGridSize(): number {
  const value = Number(elements.gridSize.value);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function autoGridForGraph(): void {
  const points = projectVertices2D(graph.vertices_coords ?? []);
  if (points.length === 0) return;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (!(span > 0)) return;
  const units = graph.file_units;
  if (units === "mm" || span > 20) {
    const candidate = span / 20;
    const magnitude = 10 ** Math.floor(Math.log10(candidate));
    const normalized = candidate / magnitude;
    const rounded = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
    elements.gridSize.value = String(rounded * magnitude);
  } else {
    elements.gridSize.value = String(Number((span / 10).toPrecision(3)));
  }
}

function displayUnits(): string {
  const units = graph.file_units;
  if (typeof units !== "string" || units.length === 0 || units === "unit") return "";
  return ` ${units}`;
}

function formatNumber(value: number): string {
  const magnitude = Math.abs(value);
  const digits = magnitude >= 100 ? 1 : magnitude >= 10 ? 2 : 3;
  return Number(value.toFixed(digits)).toString();
}

function formatLength(value: number): string {
  return `${formatNumber(value)}${displayUnits()}`;
}

function formatAngle(value: number): string {
  return `${Number(value.toFixed(1))}°`;
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches("input, textarea, select") || target.isContentEditable;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function required<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as unknown as T;
}
