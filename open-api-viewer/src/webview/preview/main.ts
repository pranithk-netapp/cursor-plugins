// Browser-side entry point for the "Preview" webview panel (Swagger UI).
// Runs inside the webview's sandboxed iframe — no `vscode` module is
// available here. Communication with the extension host happens only via
// `acquireVsCodeApi()` / `postMessage`, per the CSP set up in
// src/vscode/webview/html.ts.
//
// `SwaggerUIBundle` is a global provided by media/swagger-ui/swagger-ui-bundle.js,
// which html.ts loads via a <script> tag BEFORE this bundle.

// `export {}` forces this file to be treated as an ES module rather than a
// global script — without it, top-level declarations (like `vscode` below)
// collide across sibling webview entry points when tsc type-checks all of
// src/webview/*/main.ts in one program (each is still bundled as its own
// separate, non-colliding IIFE by esbuild; this only matters to tsc).
export {};

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

declare const SwaggerUIBundle: any;

interface SpecMessage {
  type: "spec";
  spec: unknown;
}

const vscode = acquireVsCodeApi();

let ui: any;

function render(spec: unknown): void {
  ui = SwaggerUIBundle({
    spec,
    dom_id: "#ui",
    validatorUrl: null,
    supportedSubmitMethods: [],
    deepLinking: false,
    presets: [SwaggerUIBundle.presets.apis],
    layout: "BaseLayout"
  });
}

window.addEventListener("message", (event: MessageEvent<SpecMessage>) => {
  const msg = event.data;
  if (msg && msg.type === "spec") {
    if (!ui) {
      render(msg.spec);
    } else {
      ui.specActions.updateSpec(JSON.stringify(msg.spec));
    }
  }
});

// Tell the host we're ready to receive the current spec. Keeping the spec
// out of the initial HTML (rather than embedding it) keeps the CSP simple
// (no inline JSON payload) and lets the host resend on every re-analysis.
vscode.postMessage({ type: "ready" });
