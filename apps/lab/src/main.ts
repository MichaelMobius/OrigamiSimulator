import {
  LegacyWebGLSolverAdapter,
  normalizeFoldGraph,
  validateFoldForSimulation,
  type EdgeAssignment,
  type FoldDiagnostic,
  type FoldGraph,
  type NormalizedFoldGraph,
  type SimulationFrame,
} from "../../../packages/core/src/index";
import {
  addCreaseBetweenVertices,
  deleteInternalCrease,
  GeometryEditError,
  GraphHistory,
} from "./geometryEditor";
import { splitEdgeAt } from "./edgeSplit";
import { IframeLegacyRuntime } from "./legacyRuntime";
import { PatternView } from "./patternView";
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
  toolHint: required<HTMLElement>("tool-hint"),
  fileInput: required<HTMLInputElement>("file-input"),
  legacyIframe: required<HTMLIFrameElement>("legacy-runtime"),
};

let graph = normalizeFoldGraph(structuredClone(EXAMPLE)).graph;
let selectedEdge = -1;
let activeTool: EditorTool = "select";
let pendingVertex = -1;
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
});

elements.svg.addEventListener("click", () => {
  if (activeTool === "select") selectEdge(-1);
  else {
    pendingVertex = -1;
    renderToolState();
  }
});
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
  activeTool = "select";
  history.clear();
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
  elements.metric.textContent = "flat preview";
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

    const crease = addCreaseBetweenVertices(split.graph, firstVertex, split.vertexIndex, "V", 180);
    applyGraphEdit(
      crease.graph,
      "Add crease to edge",
      crease.edgeIndex,
      split.droppedOrderMetadata || crease.droppedOrderMetadata
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
    return;
  }

  if (pendingVertex === index) {
    pendingVertex = -1;
    renderToolState();
    return;
  }

  try {
    const result = addCreaseBetweenVertices(graph, pendingVertex, index, "V", 180);
    applyGraphEdit(
      result.graph,
      "Add crease",
      result.edgeIndex,
      result.droppedOrderMetadata ? topologyMetadataDiagnostic() : undefined,
    );
    pendingVertex = -1;
  } catch (error) {
    addEditorDiagnostic(error, geometryCode(error));
    renderToolState();
  }
}

function selectEdge(index: number): void {
  selectedEdge = index;
  pattern.selectEdge(index);
  renderSelection();
}

function setTool(tool: EditorTool): void {
  activeTool = tool;
  pendingVertex = -1;
  if (tool === "crease") selectedEdge = -1;
  pattern.selectEdge(selectedEdge);
  renderSelection();
  renderToolState();
}

function renderToolState(): void {
  elements.selectTool.classList.toggle("active", activeTool === "select");
  elements.creaseTool.classList.toggle("active", activeTool === "crease");
  elements.selectTool.setAttribute("aria-pressed", String(activeTool === "select"));
  elements.creaseTool.setAttribute("aria-pressed", String(activeTool === "crease"));
  pattern.setInteraction(activeTool, pendingVertex);

  if (activeTool === "select") {
    elements.toolHint.textContent = "Select an edge to edit its assignment or angle.";
  } else if (pendingVertex < 0) {
    elements.toolHint.textContent = "Crease tool · choose a vertex or click an edge to insert one.";
  } else {
    elements.toolHint.textContent = `Crease tool · vertex ${pendingVertex} selected; choose a vertex or click an edge.`;
  }
}

function renderSelection(): void {
  const hasSelection = selectedEdge >= 0 && selectedEdge < graph.edges_vertices.length;
  elements.selectionEmpty.hidden = hasSelection;
  elements.edgeControls.hidden = !hasSelection;
  elements.deleteEdge.disabled = !hasSelection || !isInternalEdge(selectedEdge);
  if (!hasSelection) return;

  elements.edgeIndex.textContent = String(selectedEdge);
  elements.edgeAssignment.value = graph.edges_assignment[selectedEdge] ?? "U";
  const angle = graph.edges_foldAngle[selectedEdge];
  elements.edgeAngle.value = String(typeof angle === "number" ? angle : 0);
}

function updateSelectedAssignment(): void {
  if (selectedEdge < 0) return;
  const next = structuredClone(graph) as NormalizedFoldGraph;
  const assignment = elements.edgeAssignment.value as EdgeAssignment;
  next.edges_assignment[selectedEdge] = assignment;

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
  const stats = [
    ["Vertices", graph.vertices_coords?.length ?? 0],
    ["Edges", graph.edges_vertices.length],
    ["Faces", graph.faces_vertices?.length ?? 0],
    ["Mountains", graph.edges_assignment.filter((value) => value === "M").length],
    ["Valleys", graph.edges_assignment.filter((value) => value === "V").length],
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
