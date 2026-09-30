import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.ORIGAMI_BASE_URL ?? "http://127.0.0.1:4173";
const fixture = JSON.parse(
  fs.readFileSync(new URL("../fixtures/single-hinge.fold.json", import.meta.url), "utf8"),
);

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
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.goto(`${baseUrl}/?model=__origami_lab_headless__`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    () => Boolean(window.globals?.model && window.globals?.pattern && window.globals?.dynamicSolver),
    undefined,
    { timeout: 30_000 },
  );
  await page.addScriptTag({ url: `${baseUrl}/js/origamiLabLegacyBridge.js` });

  const result = await page.evaluate((fold) => {
    const bridge = window.origamiLabLegacyBridge;
    if (!bridge?.isReady()) throw new Error("legacy bridge is not ready");

    // Remove requestAnimationFrame timing from the regression. Every numerical
    // step below is invoked explicitly through model.step().
    window.globals.model.pause();
    window.globals.integrationType = "euler";

    const run = () => {
      bridge.loadFold(fold);
      bridge.setFoldPercent(0.5);
      bridge.step(200);
      const snapshot = bridge.snapshot();
      bridge.release();
      return snapshot;
    };

    const first = run();
    const second = run();

    const gl = window.globals.threeView.renderer.getContext();
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const gpu = {
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    };

    return {
      first,
      second,
      gpu,
      userAgent: navigator.userAgent,
    };
  }, fixture);

  assert.equal(result.first.verticesCoords.length, 4);
  assert.equal(result.second.verticesCoords.length, 4);
  assert.equal(typeof result.first.residual, "number");
  assert.equal(Number.isFinite(result.first.residual), true);

  let maxRepeatDelta = 0;
  for (let i = 0; i < result.first.verticesCoords.length; i += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const delta = Math.abs(
        result.first.verticesCoords[i][axis] - result.second.verticesCoords[i][axis],
      );
      maxRepeatDelta = Math.max(maxRepeatDelta, delta);
    }
  }
  assert.ok(maxRepeatDelta <= 1e-6, `legacy WebGL run is not repeatable: ${maxRepeatDelta}`);
  assert.ok(
    Math.abs(result.first.residual - result.second.residual) <= 1e-7,
    "legacy residual changed between identical runs",
  );

  const output = {
    schemaVersion: 1,
    fixture: "single-hinge",
    parameters: {
      integrationType: "euler",
      foldPercent: 0.5,
      steps: 200,
      residualUnit: "percent",
    },
    snapshot: result.first,
    repeatability: {
      maxVertexDelta: maxRepeatDelta,
      residualDelta: Math.abs(result.first.residual - result.second.residual),
    },
    environment: {
      gpu: result.gpu,
      userAgent: result.userAgent,
      pageErrors,
    },
  };

  const artifactDir = path.resolve("artifacts");
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactDir, "legacy-webgl-single-hinge.json"),
    `${JSON.stringify(output, null, 2)}\n`,
  );

  console.log(JSON.stringify(output, null, 2));
} finally {
  await browser.close();
}
