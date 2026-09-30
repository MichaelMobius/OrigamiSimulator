import type {
  LegacyWebGLRuntimeBridge,
  LegacyWebGLSnapshot,
  NormalizedFoldGraph,
} from "../../../packages/core/src/index";

type LegacyWindow = Window & {
  globals?: {
    model?: unknown;
    pattern?: unknown;
    dynamicSolver?: unknown;
  };
  origamiLabLegacyBridge?: {
    isReady(): boolean;
    loadFold(graph: NormalizedFoldGraph): void;
    setFoldPercent(percent: number): void;
    step(steps: number): void;
    snapshot(): LegacyWebGLSnapshot;
    reset(): void;
    release(): void;
  };
};

export class IframeLegacyRuntime implements LegacyWebGLRuntimeBridge {
  private readyPromise: Promise<void> | undefined;

  constructor(private readonly iframe: HTMLIFrameElement) {}

  ready(): Promise<void> {
    this.readyPromise ??= this.initialize();
    return this.readyPromise;
  }

  async loadFold(graph: NormalizedFoldGraph): Promise<void> {
    await this.ready();
    this.bridge().loadFold(graph);
  }

  async setFoldPercent(percent: number): Promise<void> {
    await this.ready();
    this.bridge().setFoldPercent(percent);
  }

  async step(steps: number): Promise<void> {
    await this.ready();
    this.bridge().step(steps);
  }

  async snapshot(): Promise<LegacyWebGLSnapshot> {
    await this.ready();
    return this.bridge().snapshot();
  }

  async reset(): Promise<void> {
    await this.ready();
    this.bridge().reset();
  }

  async release(): Promise<void> {
    await this.ready();
    this.bridge().release();
  }

  private async initialize(): Promise<void> {
    await waitForIframe(this.iframe);
    await waitUntil(() => {
      const win = this.iframe.contentWindow as LegacyWindow | null;
      return Boolean(win?.globals?.model && win.globals.pattern && win.globals.dynamicSolver);
    }, 30_000, "Legacy OrigamiSimulator runtime did not initialize.");

    const doc = this.iframe.contentDocument;
    if (!doc) throw new Error("Unable to access the same-origin legacy runtime document.");

    const existing = doc.querySelector<HTMLScriptElement>('script[data-origami-lab-bridge="true"]');
    if (!existing) {
      await new Promise<void>((resolve, reject) => {
        const script = doc.createElement("script");
        script.src = "/js/origamiLabLegacyBridge.js";
        script.dataset.origamiLabBridge = "true";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Unable to load legacy bridge."));
        doc.head.append(script);
      });
    }

    await waitUntil(
      () => Boolean((this.iframe.contentWindow as LegacyWindow | null)?.origamiLabLegacyBridge?.isReady()),
      10_000,
      "Legacy bridge did not become ready.",
    );
  }

  private bridge() {
    const bridge = (this.iframe.contentWindow as LegacyWindow | null)?.origamiLabLegacyBridge;
    if (!bridge) throw new Error("Legacy bridge is unavailable.");
    return bridge;
  }
}

function waitForIframe(iframe: HTMLIFrameElement): Promise<void> {
  if (iframe.contentDocument?.readyState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Legacy iframe load timed out.")), 30_000);
    iframe.addEventListener("load", () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  errorMessage: string,
): Promise<void> {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error(errorMessage);
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
}
