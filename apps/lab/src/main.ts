import {
  defaultFoldAngle,
  LegacyWebGLSolverAdapter,
  normalizeFoldGraph,
  validateFoldGraph,
  type EdgeAssignment,
  type FoldDiagnostic,
  type FoldGraph,
  type NormalizedFoldGraph,
} from "../../../packages/core/src/index";
import {
  addCreaseBetweenVertices,
  deleteInternalCrease,
  GeometryEditError,
  GraphHistory,
} from "./geometryEditor";
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
    elements.runtimeStatus.textContent = "Legacy solver ready";
    elements.runtimeStatus.className = "runtime-status ready";
  } catch (error) {
    elements.runtimeStatus.textContent = "Solver unavailable";
    elements.runtimeStatus.className = "runtime-status error";
    addEditorDiagnostic(error, "runtime");
  }
}

function loadGraph(input: FoldGraph): void {
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

function handleEdgeSelect(index: number): void {
  if (activeTool === "crease") {
    pendingVertex = -1;
    setTool("select");
  }
  selectEdge(index);
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
    applyGraphEdit(result.graph, "Add crease", result.edgeIndex);
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
    elements.toolHint.textContent = "Crease tool · choose the first vertex.";
  } else {
    elements.toolHint.textContent = `Crease tool · vertex ${pendingVertex} selected; choose a second vertex on the same face.`;
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
  const canonical = defaultFoldAngle(assignment);
  if (
    current === null || current === undefined ||
    (assignment === "M" && current >= 0) ||
    (assignment === "V" && current <= 0) ||
    !["M", "V"].includes(assignment)
  ) {
    next.edges_foldAngle[selectedEdge] = canonical;
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
    applyGraphEdit(result.graph, "Delete crease", -1);
  } catch (error) {
    addEditorDiagnostic(error, geometryCode(error));
  }
}

function applyGraphEdit(next: NormalizedFoldGraph, label: string, nextSelectedEdge: number): void {
  history.record(graph, label);
  graph = next;
  selectedEdge = nextSelectedEdge;
  pendingVertex = -1;
  sourceDiagnostics = [];
  editorDiagnostics = [];
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
  if (!(event.ctrlKey || event.metaKey)) return;
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
  const validation = validateFoldGraph(graph);
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

  const errors = validation.errors.length;
  const warnings = validation.warnings.length + sourceDiagnostics.filter(({ severity }) => severity === "warning").length;
  elements.validationBadge.className = `badge ${errors > 0 ? "bad" : warnings > 0 ? "warn" : "good"}`;
  elements.validationBadge.textContent = errors > 0 ? `${errors} errors` : warnings > 0 ? `${warnings} warnings` : "valid";
  elements.simulate.disabled = errors > 0;
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
  elements.simulate.disabled = true;
  elements.simulate.textContent = "Solving…";
  elements.metric.textContent = "computing";
  try {
    const frame = await solver.simulate({
      graph,
      foldPercent: Number(elements.foldPercent.value) / 100,
      maxIterations: 200,
    });
    scene.setGraph(graph, frame.verticesCoords);
    elements.metric.textContent = frame.residual === undefined
      ? `${frame.iteration} steps`
      : `${frame.residual.toFixed(5)}% error · ${frame.iteration} steps`;
  } catch (error) {
    addEditorDiagnostic(error, "runtime");
    elements.metric.textContent = "solver error";
  } finally {
    elements.simulate.disabled = !validateFoldGraph(graph).valid;
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
    const parsed = JSON.parse(await file.text()) as FoldGraph;
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
  URL.revokeObjectURL(url);
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function required<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as unknown as T;
}
