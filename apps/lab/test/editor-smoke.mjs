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

  await page.locator(".pattern-edge").nth(4).click();
  assert.equal(await page.locator("#delete-edge-button").isEnabled(), true);
  await page.locator("#delete-edge-button").click();
  assert.equal(await page.locator(".pattern-edge").count(), 4);
  assert.match(await page.locator("#model-stats").innerText(), /Faces\s+1/);

  await page.locator("#crease-tool").click();
  await page.locator(".pattern-vertex").nth(0).click();
  const pendingRadius = Number(await page.locator(".pattern-vertex.pending").getAttribute("r"));
  const pendingStroke = Number(await page.locator(".pattern-vertex.pending").getAttribute("stroke-width"));
  assert.ok(pendingRadius < 0.02, `pending vertex radius is too large: ${pendingRadius}`);
  assert.ok(pendingStroke <= 2, `pending vertex stroke is too large: ${pendingStroke}`);
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

  // In crease mode, clicking an edge inserts a vertex exactly on that edge.
  await page.locator("#crease-tool").click();
  await page.locator(".pattern-edge").nth(0).click({ position: { x: 20, y: 1 } });
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
      patternEdges: 5,
      compactVertexSelection: true,
      edgeVertexInsertion: true,
      geometryEditing: true,
      undoRedo: true,
      assignmentMagnitudePreserved: true,
      pageErrors: errors,
      failedRequests,
      badResponses,
    }, null, 2)}\n`,
  );
  console.log(`Origami Lab v0.4 smoke test passed at ${baseUrl}: ${metric}`);
} finally {
  await browser.close();
}
