import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.ORIGAMI_LAB_URL ?? "http://127.0.0.1:5173/apps/lab/";
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#runtime-status.ready", { timeout: 30_000 });

  assert.equal(await page.locator(".sketch-draw-section .assignment-palette").isVisible(), false);
  assert.equal(await page.locator("[data-edge-assignment]").count(), 5);
  assert.match(await page.locator(".geometry-workflow").innerText(), /Draw lines/i);
  assert.match(await page.locator(".geometry-workflow").innerText(), /Choose its color/i);

  await createCustomSheet(page, "Geometry first smoke", 200, 140);
  await page.waitForFunction(() => document.querySelector('[data-draw-assignment="U"]')?.getAttribute("aria-pressed") === "true");

  await page.locator("#crease-tool").click();
  await setExactLine(page, { x: 0, y: 70, length: 200, angle: 0 });
  await page.locator("#exact-draw-button").click();
  await page.waitForFunction(() => /Faces\s+2/.test(document.querySelector("#model-stats")?.innerText ?? ""));
  assert.match(await page.locator("#model-stats").innerText(), /Hinges\s+1/);
  assert.equal(await page.locator(".pattern-edge.selected").getAttribute("stroke"), "#d56cff");
  assert.match(await page.locator(".pattern-edge.selected").evaluate((el) => getComputedStyle(el).stroke), /rgb\(23, 23, 23\)/);

  assert.equal(await page.locator('[data-edge-assignment="U"]').getAttribute("aria-pressed"), "true");
  await page.locator('[data-edge-assignment="V"]').click();
  await page.waitForFunction(() => /Valleys\s+1/.test(document.querySelector("#model-stats")?.innerText ?? ""));
  assert.match(await page.locator("#model-stats").innerText(), /Hinges\s+0/);
  assert.equal(await page.locator(".pattern-edge.selected").getAttribute("stroke"), "#4b7dff");
  assert.equal(await page.locator("#edge-assignment").inputValue(), "V");

  await page.keyboard.press("m");
  await page.waitForFunction(() => /Mountains\s+1/.test(document.querySelector("#model-stats")?.innerText ?? ""));
  assert.equal(await page.locator("#edge-assignment").inputValue(), "M");
  assert.equal(await page.locator(".pattern-edge.selected").getAttribute("stroke"), "#ff4d63");

  await page.keyboard.press("v");
  assert.equal(await page.locator("#edge-assignment").inputValue(), "V");

  await setExactLine(page, { x: 0, y: 35, length: 200, angle: 0 });
  await page.locator("#exact-draw-button").click();
  await page.waitForFunction(() => /Faces\s+3/.test(document.querySelector("#model-stats")?.innerText ?? ""));
  assert.match(await page.locator("#model-stats").innerText(), /Valleys\s+1/);
  assert.match(await page.locator("#model-stats").innerText(), /Hinges\s+1/);

  await page.locator("#select-tool").click();
  await page.locator('.pattern-edge[stroke="#4b7dff"]').click();
  await page.locator('[data-edge-assignment="C"]').click();
  await page.waitForFunction(() => /Cuts\s+1/.test(document.querySelector("#model-stats")?.innerText ?? ""));
  assert.equal(await page.locator(".pattern-edge.selected").getAttribute("stroke"), "#4bd078");
  assert.match(await page.locator("#diagnostics").innerText(), /does not model physical sheet separation/i);

  await page.locator("#undo-button").click();
  assert.match(await page.locator("#model-stats").innerText(), /Cuts\s+0/);
  assert.match(await page.locator("#model-stats").innerText(), /Valleys\s+1/);

  await page.locator("#reset-example").click();
  await page.waitForFunction(() => document.querySelectorAll(".pattern-edge").length === 5);
  await page.locator("#simulate-button").click();
  await page.waitForFunction(
    () => /error.*200 steps/.test(document.querySelector("#frame-metric")?.textContent ?? ""),
    undefined,
    { timeout: 30_000 },
  );
  const metric = await page.locator("#frame-metric").innerText();
  assert.match(metric, /% error · 200 steps/);
  assert.equal(errors.length, 0, `page errors: ${errors.join("\n")}`);

  const artifactDir = path.resolve("artifacts");
  fs.mkdirSync(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, "origami-lab-editor.png"), fullPage: true });
  fs.writeFileSync(
    path.join(artifactDir, "origami-lab-smoke.json"),
    `${JSON.stringify({
      baseUrl,
      version: "0.9.0",
      workflow: "geometry-first",
      neutralDrawing: true,
      classifyAfterDrawing: true,
      semanticColors: true,
      keyboardClassification: true,
      undoRedo: true,
      metric,
      pageErrors: errors,
    }, null, 2)}\n`,
  );
  console.log(`Origami Lab v0.9 geometry-first smoke passed at ${baseUrl}: ${metric}`);
} finally {
  await browser.close();
}

async function createCustomSheet(page, title, width, height) {
  await page.locator("#new-pattern-button").click();
  await page.locator("#pattern-title").fill(title);
  await page.locator("#paper-preset").selectOption("custom");
  await page.locator("#paper-width").fill(String(width));
  await page.locator("#paper-height").fill(String(height));
  await page.locator("#new-pattern-form button[type='submit']").click();
  await page.waitForFunction(() => document.querySelectorAll(".pattern-edge").length === 4);
  assert.match(await page.locator("#validation-badge").innerText(), /valid/i);
}

async function setExactLine(page, { x, y, length, angle }) {
  await page.locator("#exact-start-x").fill(String(x));
  await page.locator("#exact-start-y").fill(String(y));
  await page.locator("#exact-length").fill(String(length));
  await page.locator("#exact-line-angle").fill(String(angle));
}
