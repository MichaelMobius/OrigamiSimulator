type Assignment = "V" | "M" | "F" | "C" | "U";

const TYPES: ReadonlyArray<{ code: Assignment; name: string; className: string }> = [
  { code: "V", name: "Valley", className: "valley" },
  { code: "M", name: "Mountain", className: "mountain" },
  { code: "F", name: "Flat", className: "flat" },
  { code: "C", name: "Cut", className: "cut" },
  { code: "U", name: "Neutral", className: "hinge" },
];

const drawSection = required<HTMLElement>(".sketch-draw-section");
const drawPalette = required<HTMLElement>(".sketch-draw-section .assignment-palette");
const drawNeutralButton = required<HTMLButtonElement>('[data-draw-assignment="U"]');
const selectTool = required<HTMLButtonElement>("#select-tool");
const lineTool = required<HTMLButtonElement>("#crease-tool");
const edgeControls = required<HTMLElement>("#edge-controls");
const edgeAssignment = required<HTMLSelectElement>("#edge-assignment");
const toolHint = required<HTMLElement>("#tool-hint");
const patternSvg = required<SVGSVGElement>("#pattern-svg");
const fileInput = required<HTMLInputElement>("#file-input");
const resetButton = required<HTMLButtonElement>("#reset-example");

setupGeometryFirstUi();
forceNeutralDrawing();
syncSelectionPalette();

const neutralObserver = new MutationObserver(() => {
  if (drawNeutralButton.getAttribute("aria-pressed") !== "true") {
    queueMicrotask(forceNeutralDrawing);
  }
});
neutralObserver.observe(drawPalette, {
  subtree: true,
  attributes: true,
  attributeFilter: ["aria-pressed", "class"],
});

const hintObserver = new MutationObserver(normalizeToolHint);
hintObserver.observe(toolHint, { childList: true, subtree: true, characterData: true });
normalizeToolHint();

window.addEventListener("click", () => queueMicrotask(syncSelectionPalette), true);
window.addEventListener("pointerup", () => queueMicrotask(syncSelectionPalette), true);
fileInput.addEventListener("change", () => window.setTimeout(forceNeutralDrawing, 0));
resetButton.addEventListener("click", () => window.setTimeout(forceNeutralDrawing, 0));
patternSvg.addEventListener("keydown", () => queueMicrotask(syncSelectionPalette));
window.addEventListener("keydown", handleAssignmentShortcut, true);

function setupGeometryFirstUi(): void {
  drawSection.classList.add("geometry-first-draw");

  const eyebrow = drawSection.querySelector<HTMLElement>(".eyebrow");
  if (eyebrow) eyebrow.textContent = "DRAW GEOMETRY";

  const sectionRow = drawSection.querySelector<HTMLElement>(".sketch-section-row");
  const workflow = document.createElement("div");
  workflow.className = "geometry-workflow";
  workflow.innerHTML = `
    <span><b>1</b> Draw lines</span>
    <span><b>2</b> Select a line</span>
    <span><b>3</b> Choose its color / type</span>
  `;
  sectionRow?.insertAdjacentElement("afterend", workflow);

  const note = drawSection.querySelector<HTMLElement>(".sketch-note");
  if (note) {
    note.textContent = "Draw the crease pattern first. New lines are neutral; select them afterwards to assign Valley, Mountain, Flat or Cut.";
  }

  const selectionEmpty = document.querySelector<HTMLElement>("#selection-empty");
  if (selectionEmpty) selectionEmpty.textContent = "Select a line, then choose its color / fold type.";

  const selectionTitle = edgeControls.querySelector<HTMLElement>(".selection-title");
  if (!selectionTitle) return;

  const panel = document.createElement("div");
  panel.className = "selection-assignment-panel";

  const header = document.createElement("div");
  header.className = "selection-type-header";
  const label = document.createElement("span");
  label.className = "sketch-subhead selection-type-title";
  label.textContent = "Line color / fold type";
  const badge = document.createElement("span");
  badge.id = "selected-type-badge";
  badge.className = "badge selected-type-badge";
  header.append(label, badge);

  const palette = document.createElement("div");
  palette.className = "assignment-palette selection-assignment-palette";
  palette.setAttribute("role", "group");
  palette.setAttribute("aria-label", "Type for selected line");

  for (const type of TYPES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `assignment-button ${type.className}`;
    button.dataset.edgeAssignment = type.code;
    button.setAttribute("aria-pressed", "false");
    button.title = `Set selected line to ${type.name}`;

    const swatch = document.createElement("i");
    const code = document.createElement("span");
    code.textContent = type.code;
    const name = document.createElement("small");
    name.textContent = type.name;
    button.append(swatch, code, name);
    button.addEventListener("click", () => applySelectedAssignment(type.code));
    palette.append(button);
  }

  const note2 = document.createElement("p");
  note2.className = "sketch-note selection-color-note";
  note2.textContent = "Color is semantic: blue = Valley, red = Mountain, yellow = Flat, green = Cut, gray = unassigned geometry.";

  panel.append(header, palette, note2);
  selectionTitle.insertAdjacentElement("afterend", panel);

  const assignmentField = edgeAssignment.closest<HTMLElement>(".field");
  if (assignmentField) {
    assignmentField.classList.add("advanced-assignment-field");
    const span = assignmentField.querySelector<HTMLElement>("span");
    if (span) span.textContent = "Advanced assignment";
  }

  const designerNote = document.querySelector<HTMLElement>(".designer-note");
  if (designerNote) {
    designerNote.innerHTML = "The new sheet starts with four boundary edges. Use <strong>+ Line</strong> to draw geometry first. Every new line starts neutral; switch to <strong>Select</strong> and assign Valley, Mountain, Flat or Cut afterwards.";
  }

  const legendHinge = Array.from(document.querySelectorAll<HTMLElement>(".legend span"))
    .find((item) => item.textContent?.includes("Hinge"));
  if (legendHinge) {
    const swatch = legendHinge.querySelector("i");
    legendHinge.replaceChildren();
    if (swatch) legendHinge.append(swatch);
    legendHinge.append("Neutral");
  }
}

function forceNeutralDrawing(): void {
  if (drawNeutralButton.getAttribute("aria-pressed") === "true") return;
  const wasSelect = selectTool.getAttribute("aria-pressed") === "true";
  drawNeutralButton.click();
  if (wasSelect) selectTool.click();
  normalizeToolHint();
}

function applySelectedAssignment(assignment: Assignment): void {
  if (edgeControls.hidden) {
    toolHint.textContent = "Select a line first, then choose Valley, Mountain, Flat or Cut.";
    return;
  }
  edgeAssignment.value = assignment;
  edgeAssignment.dispatchEvent(new Event("change", { bubbles: true }));
  queueMicrotask(syncSelectionPalette);
}

function syncSelectionPalette(): void {
  const current = edgeAssignment.value;
  document.querySelectorAll<HTMLButtonElement>("[data-edge-assignment]").forEach((button) => {
    const active = button.dataset.edgeAssignment === current && !edgeControls.hidden;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  const badge = document.querySelector<HTMLElement>("#selected-type-badge");
  if (!badge) return;
  const type = TYPES.find(({ code }) => code === current);
  badge.textContent = edgeControls.hidden ? "—" : type?.name ?? assignmentLongName(current);
  badge.dataset.assignment = current;
}

function handleAssignmentShortcut(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey || isEditingTarget(event.target)) return;
  const assignment = event.key.toUpperCase() as Assignment;
  if (!TYPES.some(({ code }) => code === assignment)) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  applySelectedAssignment(assignment);
}

function normalizeToolHint(): void {
  const value = toolHint.textContent ?? "";
  if (value.startsWith("Hinge line ·")) {
    toolHint.textContent = value.replace(/^Hinge line/, "Line");
  } else if (value.startsWith("Hinge exact line ·")) {
    toolHint.textContent = value.replace(/^Hinge exact line/, "Exact line");
  }
}

function assignmentLongName(value: string): string {
  if (value === "B") return "Boundary";
  if (value === "J") return "Join";
  return value || "—";
}

function isEditingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.matches("input, textarea, select") || target.isContentEditable);
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element as T;
}
