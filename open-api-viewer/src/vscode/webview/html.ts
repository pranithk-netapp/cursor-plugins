import * as vscode from "vscode";

// Characters used for the CSP script nonce. Alphanumeric only, per the plan.
const NONCE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function generateNonce(): string {
  return Array.from({ length: 32 }, () => NONCE_CHARS[Math.floor(Math.random() * NONCE_CHARS.length)]).join("");
}

export interface BuildWebviewHtmlOptions {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  /** The webview's own bundle (e.g. "media/dist/preview.js"), loaded LAST. */
  scriptRelPath: string;
  /**
   * Library scripts (e.g. "media/swagger-ui/swagger-ui-bundle.js") that must
   * load BEFORE `scriptRelPath`, in the given order. Each gets its own
   * <script> tag sharing the same nonce.
   */
  preScriptRelPaths?: string[];
  /** Stylesheets, converted to webview URIs and linked in <head>. */
  cssRelPaths?: string[];
  /**
   * Additional local script tags emitted AFTER the main `scriptRelPath`
   * script. Reserved for webviews that need auxiliary scripts loaded once
   * their own bundle has run; unused by the Preview panel.
   */
  extraLocalResourceScripts?: string[];
  title: string;
  /** Raw HTML placed in <body>, before any <script> tags. */
  bodyHtml: string;
  /** CSP connect-src value; defaults to "'none'" (no network from webviews). */
  connectSrc?: string;
}

/**
 * Build a full HTML document for a webview panel with a strict, nonced CSP:
 * no inline scripts, no remote origins beyond the webview's own resources
 * (via `webview.cspSource`), and no network access unless `connectSrc` is
 * explicitly widened by the caller.
 */
export function buildWebviewHtml(opts: BuildWebviewHtmlOptions): string {
  const { webview, extensionUri } = opts;
  const nonce = generateNonce();

  const toWebviewUri = (relPath: string): string =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, relPath)).toString();

  const cssLinks = (opts.cssRelPaths ?? [])
    .map((relPath) => `<link rel="stylesheet" href="${toWebviewUri(relPath)}">`)
    .join("\n  ");

  const preScriptTags = (opts.preScriptRelPaths ?? [])
    .map((relPath) => `<script nonce="${nonce}" src="${toWebviewUri(relPath)}"></script>`)
    .join("\n  ");

  const mainScriptTag = `<script nonce="${nonce}" src="${toWebviewUri(opts.scriptRelPath)}"></script>`;

  const extraScriptTags = (opts.extraLocalResourceScripts ?? [])
    .map((relPath) => `<script nonce="${nonce}" src="${toWebviewUri(relPath)}"></script>`)
    .join("\n  ");

  const connectSrc = opts.connectSrc ?? "'none'";
  const csp =
    `default-src 'none'; img-src ${webview.cspSource} data:; ` +
    `style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; ` +
    `font-src ${webview.cspSource}; connect-src ${connectSrc};`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
${cssLinks}
<title>${opts.title}</title>
</head>
<body>
${opts.bodyHtml}
${preScriptTags}
${mainScriptTag}
${extraScriptTags}
</body>
</html>`;
}
