import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.ORIGAMI_LAB_URL ?? "http://127.0.0.1:5173/apps/lab/";
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#runtime-status.ready", { timeout: 30_000 });

  assert.equal(await page.locator("[data-draw-assignment]").count(), 5);
  assert.equal(await page.locator('[data-draw-assignment="V"]').getAttribute("aria-pressed"), "true");
  assert.match(await page.locator("#draw-type-label").innerText(), /Valley/i);

  // Exact valley line from boundary to boundary.
  await createCustomSheet(page, "Sketch tools smoke", 200, 140);
  await setExactLine(page, { x: 0, y: 70, length: 200, angle: 0 });
  await page.locator("#exact-draw-button").click();
  await page.waitForTimeout(400);
  await assertModelMatches(page, /Faces\s+2/, "first exact valley line");
  assert.match(await page.locator("#model-stats").innerText(), /Valleys\s+1/);
  assert.equal(await page.locator(".pattern-vertex").count(), 6);

  // Exact mountain line crossing the valley. Intersection topology is automatic.
  await page.locator('[data-draw-assignment="M"]').click();
  assert.match(await page.locator("#draw-type-label").innerText(), /Mountain/i);
  await setExactLine(page, { x: 100, y: 0, length: 140, angle: 90 });
  await page.locator("#exact-draw-button").click();
  await page.waitForTimeout(400);
  await assertModelMatches(page, /Faces\s+4/, "crossing exact mountain line");
  assert.equal(await page.locator(".pattern-vertex").count(), 9);
  assert.match(await page.locator("#model-stats").innerText(), /Mountains\s+2/);
  assert.match(await page.locator("#model-stats").innerText(), /Valleys\s+2/);
  assert.match(await page.locator("#validation-badge").innerText(), /valid/i);

  // Focus design expands the sketch workspace without destroying the 3D view.
  await page.locator("#design-focus-button").click();
  assert.equal(await page.locator("#workspace").evaluate((element) => element.classList.contains("design-focus")), true);
  assert.equal(await page.locator("#design-focus-button").getAttribute("aria-pressed"), "true");
  assert.match(await page.locator("#design-focus-button").innerText(), /Show 3D/i);
  await page.locator("#design-focus-button").click();
  assert.equal(await page.locator("#workspace").evaluate((element) => element.classList.contains("design-focus")), false);

  // Smart dimension: keep edge 0's first endpoint fixed and shorten it precisely.
  await createCustomSheet(page, "Dimension smoke", 200, 140);
  await clickEdgeByIndex(page, 0);
  assert.equal(Number(await page.locator("#edge-planar-length").inputValue()), 200);
  assert.equal(Number(await page.locator("#edge-planar-angle").inputValue()), 0);
  await page.locator("#edge-planar-length").fill("180");
  await page.locator("#edge-planar-angle").fill("0");
  await page.locator("#apply-edge-geometry").click();
  assert.ok(Math.abs(Number(await page.locator('.pattern-vertex[data-index="1"]').getAttribute("cx")) - 180) < 1e-6);
  assert.match(await page.locator("#validation-badge").innerText(), /valid/i);
  await page.locator("#undo-button").click();
  assert.ok(Math.abs(Number(await page.locator('.pattern-vertex[data-index="1"]').getAttribute("cx")) - 200) < 1e-6);

  // Cut is a first-class authoring assignment and clearly warns about 3D separation.
  await page.locator('[data-draw-assignment="C"]').click();
  await setExactLine(page, { x: 0, y: 70, length: 200, angle: 0 });
  await page.locator("#exact-draw-button").click();
  await page.waitForTimeout(400);
  await assertModelMatches(page, /Cuts\s+1/, "exact cut line");
  assert.match(await page.locator("#diagnostics").innerText(), /does not model physical sheet separation/i);

  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join("\n")}`);
  console.log(`Origami Lab v0.8 sketch tools smoke passed at ${baseUrl}`);
} finally {
  await browser.close();
}

async function assertModelMatches(page, pattern, label) {
  const stats = await page.locator("#model-stats").innerText();
  if (!pattern.test(stats)) {
    const diagnostics = await page.locator("#diagnostics").innerText();
    const hint = await page.locator("#tool-hint").innerText();
    const pending = await page.locator(".pattern-vertex.pending").count();
    const vertices = await page.locator(".pattern-vertex").count();
    const edges = await page.locator(".pattern-edge").count();
    throw new Error(`${label} failed\nstats:\n${stats}\ndiagnostics:\n${diagnostics}\nhint: ${hint}\npending=${pending} vertices=${vertices} edges=${edges}`);
  }
}

async function createCustomSheet(page, title, width, height) {
  await page.locator("#new-pattern-button").click();
  await page.locator("#pattern-title").fill(title);
  await page.locator("#paper-preset").selectOption("custom");
  await page.locator("#paper-width").fill(String(width));
  await page.locator("#paper-height").fill(String(height));
  await page.locator("#new-pattern-form button[type='submit']").click();
  await page.waitForFunction(() => document.querySelectorAll(".pattern-edge").length === 4);
}

async function setExactLine(page, { x, y, length, angle }) {
  await page.locator("#exact-start-x").fill(String(x));
  await page.locator("#exact-start-y").fill(String(y));
  await page.locator("#exact-length").fill(String(length));
  await page.locator("#exact-line-angle").fill(String(angle));
}

async function clickEdgeByIndex(page, index) {
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
