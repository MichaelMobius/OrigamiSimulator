import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.ORIGAMI_LAB_URL ?? "http://127.0.0.1:5173/apps/lab/";
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
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#runtime-status.ready", { timeout: 30_000 });

  assert.equal(await page.locator(".pattern-edge").count(), 5);
  assert.equal(await page.locator("#three-stage canvas").count(), 1);
  assert.match(await page.locator("#validation-badge").innerText(), /valid/i);

  // Select the diagonal crease and verify that the modern editor can modify it.
  await page.locator(".pattern-edge").nth(4).click();
  assert.equal(await page.locator("#edge-index").innerText(), "4");
  await page.locator("#edge-assignment").selectOption("M");
  assert.equal(await page.locator("#edge-angle").inputValue(), "-180");

  // Return to the known valley fixture before evaluating the numerical path.
  await page.locator("#edge-assignment").selectOption("V");
  await page.locator("#edge-angle").fill("90");
  await page.locator("#edge-angle").dispatchEvent("change");

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
  await page.screenshot({
    path: path.join(artifactDir, "origami-lab-editor.png"),
    fullPage: true,
  });

  fs.writeFileSync(
    path.join(artifactDir, "origami-lab-smoke.json"),
    `${JSON.stringify({ metric, patternEdges: 5, pageErrors: errors }, null, 2)}\n`,
  );
  console.log(`Origami Lab smoke test passed: ${metric}`);
} finally {
  await browser.close();
}
