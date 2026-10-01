import { createRectangularPattern } from "./patternFactory";

const openButton = required<HTMLButtonElement>("new-pattern-button");
const dialog = required<HTMLDialogElement>("new-pattern-dialog");
const form = required<HTMLFormElement>("new-pattern-form");
const cancelButton = required<HTMLButtonElement>("new-pattern-cancel");
const preset = required<HTMLSelectElement>("paper-preset");
const widthInput = required<HTMLInputElement>("paper-width");
const heightInput = required<HTMLInputElement>("paper-height");
const titleInput = required<HTMLInputElement>("pattern-title");
const fileInput = required<HTMLInputElement>("file-input");
const errorBox = required<HTMLElement>("new-pattern-error");

const PRESETS: Record<string, readonly [number, number]> = {
  square: [210, 210],
  a4p: [210, 297],
  a4l: [297, 210],
  letterp: [215.9, 279.4],
};

openButton.addEventListener("click", () => {
  errorBox.textContent = "";
  dialog.showModal();
  titleInput.focus();
});

cancelButton.addEventListener("click", () => dialog.close());

preset.addEventListener("change", () => {
  const dimensions = PRESETS[preset.value];
  if (!dimensions) return;
  widthInput.value = String(dimensions[0]);
  heightInput.value = String(dimensions[1]);
});

for (const input of [widthInput, heightInput]) {
  input.addEventListener("input", () => {
    const dimensions = PRESETS[preset.value];
    if (!dimensions) return;
    if (Number(widthInput.value) !== dimensions[0] || Number(heightInput.value) !== dimensions[1]) {
      preset.value = "custom";
    }
  });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  errorBox.textContent = "";
  try {
    const graph = createRectangularPattern({
      width: Number(widthInput.value),
      height: Number(heightInput.value),
      title: titleInput.value,
      units: "mm",
    });
    const file = new File(
      [`${JSON.stringify(graph, null, 2)}\n`],
      `${slug(graph.frame_title ?? "origami-pattern")}.fold`,
      { type: "application/json" },
    );
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    dialog.close();
  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : String(error);
  }
});

dialog.addEventListener("click", (event) => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right
    && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!inside) dialog.close();
});

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "origami-pattern";
}

function required<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as unknown as T;
}
