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
  diagnostics: required<HTMLElement>("diagnostics"),
  validationBadge: required<HTMLElement>("validation-badge"),
  modelStats: required<HTMLElement>("model-stats"),
  resetExample: required<HTMLButtonElement>("reset-example"),
  importButton: required<HTMLButtonElement>("import-button"),
  exportButton: required<HTMLButtonElement>("export-button"),
  fileInput: required<HTMLInputElement>("file-input"),
  legacyIframe: required<HTMLIFrameElement>("legacy-runtime"),
};

let graph = normalizeFoldGraph(structuredClone(EXAMPLE)).graph;
let selectedEdge = -1;
let sourceDiagnostics: FoldDiagnostic[] = [];

const runtime = new IframeLegacyRuntime(elements.legacyIframe);
const solver = new LegacyWebGLSolverAdapter(runtime, { defaultIterations: 200, chunkSize: 50 });
const scene = new OrigamiScene(elements.threeStage);
const pattern = new PatternView({
  svg: elements.svg,
  empty: elements.empty,
  onSelect: selectEdge,
});

elements.svg.addEventListener("click", () => selectEdge(-1));
elements.foldPercent.addEventListener("input", updateFoldPercentLabel);
elements.simulate.addEventListener("click", () => void simulate());
elements.edgeAssignment.addEventListener("change", updateSelectedAssignment);
elements.edgeAngle.addEventListener("change", updateSelectedAngle);
elements.resetExample.addEventListener("click", () => loadGraph(EXAMPLE));
elements.importButton.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", () => void importFile());
elements.exportButton.addEventListener("click", exportFold);

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
    addRuntimeDiagnostic(error);
  }
}

function loadGraph(input: FoldGraph): void {
  const normalized = normalizeFoldGraph(structuredClone(input));
  graph = normalized.graph;
  sourceDiagnostics = normalized.diagnostics;
  selectedEdge = -1;
  renderAll();
}

function renderAll(): void {
  pattern.setGraph(graph);
  pattern.select(selectedEdge);
  scene.setGraph(graph);
  renderSelection();
  renderDiagnostics();
  renderStats();
  elements.metric.textContent = "flat preview";
}

function selectEdge(index: number): void {
  selectedEdge = index;
  pattern.select(index);
  renderSelection();
}

function renderSelection(): void {
  const hasSelection = selectedEdge >= 0 && selectedEdge < graph.edges_vertices.length;
  elements.selectionEmpty.hidden = hasSelection;
  elements.edgeControls.hidden = !hasSelection;
  if (!hasSelection) return;

  elements.edgeIndex.textContent = String(selectedEdge);
  elements.edgeAssignment.value = graph.edges_assignment[selectedEdge] ?? "U";
  const angle = graph.edges_foldAngle[selectedEdge];
  elements.edgeAngle.value = String(typeof angle === "number" ? angle : 0);
}

function updateSelectedAssignment(): void {
  if (selectedEdge < 0) return;
  const assignment = elements.edgeAssignment.value as EdgeAssignment;
  graph.edges_assignment[selectedEdge] = assignment;
  const current = graph.edges_foldAngle[selectedEdge];
  const canonical = defaultFoldAngle(assignment);
  if (
    current === null || current === undefined ||
    (assignment === "M" && current >= 0) ||
    (assignment === "V" && current <= 0) ||
    !["M", "V"].includes(assignment)
  ) {
    graph.edges_foldAngle[selectedEdge] = canonical;
  }
  renderAllPreserveSelection();
}

function updateSelectedAngle(): void {
  if (selectedEdge < 0) return;
  const value = Number(elements.edgeAngle.value);
  if (!Number.isFinite(value)) return;
  graph.edges_foldAngle[selectedEdge] = Math.max(-180, Math.min(180, value));
  sourceDiagnostics = [];
  renderAllPreserveSelection();
}

function renderAllPreserveSelection(): void {
  pattern.setGraph(graph);
  pattern.select(selectedEdge);
  scene.setGraph(graph);
  renderSelection();
  renderDiagnostics();
  renderStats();
}

function renderDiagnostics(): void {
  const validation = validateFoldGraph(graph);
  const diagnostics = [...sourceDiagnostics, ...validation.diagnostics];
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
    addRuntimeDiagnostic(error);
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
    addRuntimeDiagnostic(new Error(`Unable to import ${file.name}: ${messageOf(error)}`));
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

function addRuntimeDiagnostic(error: unknown): void {
  const item = document.createElement("div");
  item.className = "diagnostic error";
  const code = document.createElement("code");
  code.textContent = "runtime";
  const message = document.createElement("span");
  message.textContent = messageOf(error);
  item.append(code, message);
  elements.diagnostics.prepend(item);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function required<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as unknown as T;
}
