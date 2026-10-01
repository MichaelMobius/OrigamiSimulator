import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.ORIGAMI_LAB_URL ?? "http://127.0.0.1:5173/apps/lab/";
const baseOrigin = new URL(baseUrl).origin;
const criticalTypes = new Set(["document", "script", "stylesheet", "xhr", "fetch"]);
const browser = await chromium.launch({
  headless: true,
  args: [
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-gl=angle",
    "--use-angle=swiftshader",
  ],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const failedRequests = [];
  const badResponses = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("requestfailed", (request) => {
    if (!criticalTypes.has(request.resourceType())) return;
    try {
      if (new URL(request.url()).origin !== baseOrigin) return;
    } catch {
      return;
    }
    failedRequests.push(`${request.resourceType()} ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`);
  });
  page.on("response", (response) => {
    const request = response.request();
    if (!criticalTypes.has(request.resourceType()) || response.status() < 400) return;
    try {
      if (new URL(response.url()).origin !== baseOrigin) return;
    } catch {
      return;
    }
    badResponses.push(`${response.status()} ${request.resourceType()} ${response.url()}`);
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#runtime-status.ready", { timeout: 30_000 });

  assert.equal(await page.locator(".pattern-edge").count(), 5);
  assert.equal(await page.locator(".pattern-vertex").count(), 4);
  assert.equal(await page.locator(".pattern-vertex-hit").count(), 4);
  assert.equal(await page.locator("#three-stage canvas").count(), 1);
  assert.match(await page.locator("#validation-badge").innerText(), /valid/i);
  assert.equal(await page.locator(".pattern-vertex-hit").first().getAttribute("fill"), "none");

  // CAD scenario 1: start a new sheet and create a crease from a free interior point.
  await createCustomSheet(page, "Free point smoke", 200, 140);
  await page.locator("#crease-tool").click();
  assert.equal(await page.locator("#snap-toggle").getAttribute("aria-pressed"), "true");
  assert.ok((await page.locator(".pattern-grid line").count()) > 0, "CAD grid should be visible");
  await clickSvgPoint(page, 100, 70);
  assert.equal(await page.locator(".pattern-vertex").count(), 5);
  assert.equal(await page.locator(".pattern-vertex.pending").count(), 1);
  assert.equal(await page.locator(".pattern-edge.auxiliary").count(), 4);
  assert.match(await page.locator("#model-stats").innerText(), /CAD topology\s+4/);
  await page.locator(".pattern-vertex").nth(0).click();
  assert.equal(await page.locator(".pattern-vertex.pending").count(), 0);
  assert.match(await page.locator("#model-stats").innerText(), /Valleys\s+1/);
  assert.match(await page.locator("#validation-badge").innerText(), /valid/i);

  // CAD scenario 2: two full-sheet creases cross. The second one must split the
  // first crease and create one explicit intersection vertex automatically.
  await createCustomSheet(page, "Intersection smoke", 200, 140);
  await page.locator("#crease-tool").click();
  await clickEdgeAtConstant(page, "y", 0);
  await clickEdgeAtConstant(page, "y", 140);
  await page.waitForFunction(() => document.querySelectorAll(".pattern-edge").length === 7);
  assert.equal(await page.locator(".pattern-vertex").count(), 6);
  assert.match(await page.locator("#model-stats").innerText(), /Faces\s+2/);

  await clickEdgeAtConstant(page, "x", 0);
  await clickEdgeAtConstant(page, "x", 200);
  await page.waitForFunction(() => document.querySelectorAll(".pattern-vertex").length === 9);
  assert.equal(await page.locator(".pattern-edge").count(), 12);
  assert.match(await page.locator("#model-stats").innerText(), /Faces\s+4/);
  assert.match(await page.locator("#model-stats").innerText(), /Valleys\s+4/);
  assert.match(await page.locator("#validation-badge").innerText(), /valid/i);

  // Restore the canonical fixture for the existing editor and solver regression flow.
  await page.locator("#reset-example").click();
  await page.waitForFunction(() => document.querySelectorAll(".pattern-edge").length === 5);

  await page.locator(".pattern-edge").nth(4).click();
  const selectedEdgeFilter = await page.locator(".pattern-edge.selected").evaluate((element) => getComputedStyle(element).filter);
  assert.equal(selectedEdgeFilter, "none", `selected edge unexpectedly has filter: ${selectedEdgeFilter}`);
  assert.equal(await page.locator("#delete-edge-button").isEnabled(), true);
  await page.locator("#delete-edge-button").click();
  assert.equal(await page.locator(".pattern-edge").count(), 4);
  assert.match(await page.locator("#model-stats").innerText(), /Faces\s+1/);

  await page.locator("#crease-tool").click();
  await page.locator(".pattern-vertex").nth(0).click();
  const pendingRadius = Number(await page.locator(".pattern-vertex.pending").getAttribute("r"));
  const pendingStroke = Number(await page.locator(".pattern-vertex.pending").getAttribute("stroke-width"));
  const pendingFilter = await page.locator(".pattern-vertex.pending").evaluate((element) => getComputedStyle(element).filter);
  assert.ok(pendingRadius < 0.02, `pending vertex radius is too large: ${pendingRadius}`);
  assert.ok(pendingStroke <= 2, `pending vertex stroke is too large: ${pendingStroke}`);
  assert.equal(pendingFilter, "none", `pending vertex unexpectedly has filter: ${pendingFilter}`);
  await page.locator(".pattern-vertex").nth(2).click();
  assert.equal(await page.locator(".pattern-edge").count(), 5);
  assert.match(await page.locator("#model-stats").innerText(), /Faces\s+2/);

  await page.locator("#undo-button").click();
  assert.equal(await page.locator(".pattern-edge").count(), 4);
  await page.locator("#redo-button").click();
  assert.equal(await page.locator(".pattern-edge").count(), 5);

  await page.locator("#select-tool").click();
  await page.locator(".pattern-edge").nth(4).click();
  assert.equal(await page.locator("#edge-assignment").inputValue(), "V");
  await page.locator("#edge-angle").fill("90");
  await page.locator("#edge-angle").dispatchEvent("change");
  await page.locator("#edge-assignment").selectOption("M");
  assert.equal(await page.locator("#edge-angle").inputValue(), "-90");
  await page.locator("#edge-assignment").selectOption("V");
  assert.equal(await page.locator("#edge-angle").inputValue(), "90");

  await page.locator("#crease-tool").click();
  await clickEdgeMidpoint(page, 0);
  assert.equal(await page.locator(".pattern-vertex").count(), 5);
  assert.equal(await page.locator(".pattern-edge").count(), 6);
  assert.match(await page.locator("#model-stats").innerText(), /Vertices\s+5/);
  assert.equal(await page.locator(".pattern-vertex.pending").count(), 1);

  await page.locator("#undo-button").click();
  assert.equal(await page.locator(".pattern-vertex").count(), 4);
  assert.equal(await page.locator(".pattern-edge").count(), 5);
  await page.locator("#select-tool").click();

  await page.locator("#simulate-button").click();
  await page.waitForFunction(
    () => /error.*200 steps/.test(document.querySelector("#frame-metric")?.textContent ?? ""),
    undefined,
    { timeout: 30_000 },
  );

  const metric = await page.locator("#frame-metric").innerText();
  assert.match(metric, /% error · 200 steps/);
  assert.equal(errors.length, 0, `page errors: ${errors.join("\n")}`);
  assert.equal(failedRequests.length, 0, `failed critical same-origin requests: ${failedRequests.join("\n")}`);
  assert.equal(badResponses.length, 0, `bad critical same-origin responses: ${badResponses.join("\n")}`);

  const artifactDir = path.resolve("artifacts");
  fs.mkdirSync(artifactDir, { recursive: true });
  await page.screenshot({
    path: path.join(artifactDir, "origami-lab-editor.png"),
    fullPage: true,
  });

  fs.writeFileSync(
    path.join(artifactDir, "origami-lab-smoke.json"),
    `${JSON.stringify({
      baseUrl,
      metric,
      version: "0.6.0",
      newPatternDesigner: true,
      freePointDrawing: true,
      snappingAndGrid: true,
      automaticIntersections: true,
      compactVertexSelection: true,
      svgSelectionFiltersDisabled: true,
      geometryEditing: true,
      undoRedo: true,
      assignmentMagnitudePreserved: true,
      pageErrors: errors,
      failedRequests,
      badResponses,
    }, null, 2)}\n`,
  );
  console.log(`Origami Lab v0.6 smoke test passed at ${baseUrl}: ${metric}`);
} finally {
  await browser.close();
}

async function createCustomSheet(page, title, width, height) {
  await page.locator("#new-pattern-button").click();
  assert.equal(await page.locator("#new-pattern-dialog").evaluate((element) => element.open), true);
  await page.locator("#pattern-title").fill(title);
  await page.locator("#paper-preset").selectOption("custom");
  await page.locator("#paper-width").fill(String(width));
  await page.locator("#paper-height").fill(String(height));
  await page.locator("#new-pattern-form button[type='submit']").click();
  await page.waitForFunction(() => document.querySelectorAll(".pattern-edge").length === 4);
  assert.equal(await page.locator(".pattern-vertex").count(), 4);
  assert.match(await page.locator("#model-stats").innerText(), /Faces\s+1/);
  assert.match(await page.locator("#validation-badge").innerText(), /valid/i);
}

async function clickSvgPoint(page, x, y) {
  await page.locator("#pattern-svg").evaluate((svg, point) => {
    const matrix = svg.getScreenCTM();
    if (!matrix) throw new Error("SVG transform unavailable");
    const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    svg.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      clientX: screen.x,
      clientY: screen.y,
    }));
  }, { x, y });
}

async function clickEdgeAtConstant(page, axis, value) {
  await page.locator(".pattern-edge").evaluateAll((lines, spec) => {
    const first = spec.axis === "x" ? "x1" : "y1";
    const second = spec.axis === "x" ? "x2" : "y2";
    const line = lines.find((candidate) =>
      Math.abs(Number(candidate.getAttribute(first)) - spec.value) < 1e-6 &&
      Math.abs(Number(candidate.getAttribute(second)) - spec.value) < 1e-6,
    );
    if (!line) throw new Error(`Unable to find boundary edge at ${spec.axis}=${spec.value}`);
    const svg = line.ownerSVGElement;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) throw new Error("SVG transform unavailable");
    const x1 = Number(line.getAttribute("x1"));
    const y1 = Number(line.getAttribute("y1"));
    const x2 = Number(line.getAttribute("x2"));
    const y2 = Number(line.getAttribute("y2"));
    const midpoint = new DOMPoint((x1 + x2) / 2, (y1 + y2) / 2).matrixTransform(matrix);
    line.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      clientX: midpoint.x,
      clientY: midpoint.y,
    }));
  }, { axis, value });
}

async function clickEdgeMidpoint(page, index) {
  await page.locator(".pattern-edge").nth(index).evaluate((line) => {
    const svg = line.ownerSVGElement;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) throw new Error("SVG transform unavailable");
    const x1 = Number(line.getAttribute("x1"));
    const y1 = Number(line.getAttribute("y1"));
    const x2 = Number(line.getAttribute("x2"));
    const y2 = Number(line.getAttribute("y2"));
    const midpoint = new DOMPoint((x1 + x2) / 2, (y1 + y2) / 2).matrixTransform(matrix);
    line.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      clientX: midpoint.x,
      clientY: midpoint.y,
    }));
  });
}
