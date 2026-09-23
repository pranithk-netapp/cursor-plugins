// Browser-side entry point for the "Audit Report" webview panel. Runs
// inside the webview's sandboxed iframe — no `vscode` module is available
// here (see src/vscode/webview/reportPanel.ts for the extension-host side
// of the message protocol).

// See src/webview/preview/main.ts for why this needs an explicit export.
export {};

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

type AuditCategory = "security" | "dataValidation" | "quality";
type AuditSeverity = "critical" | "high" | "medium" | "low";

interface AuditFinding {
  ruleId: string;
  pointer: string;
  message: string;
}

interface AuditRuleResult {
  rule: {
    id: string;
    category: AuditCategory;
    severity: AuditSeverity;
    weight: number;
    title: string;
    description: string;
  };
  findings: AuditFinding[];
  eligible: number;
  effectiveWeight: number;
  deduction: number;
  off: boolean;
}

interface AuditReport {
  total: number;
  categories: Record<AuditCategory, { score: number; max: number }>;
  ruleResults: AuditRuleResult[];
}

interface ReportMessage {
  type: "report";
  report: AuditReport;
}

const vscode = acquireVsCodeApi();
const root = document.getElementById("report")!;

const CATEGORY_LABEL: Record<AuditCategory, string> = {
  security: "Security",
  dataValidation: "Data validation",
  quality: "Quality",
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function render(report: AuditReport): void {
  root.innerHTML = "";

  const header = el("div", "score-header");
  header.appendChild(el("div", "score-total", `${report.total}/100`));
  const rerun = el("button", "rerun-button", "Re-run");
  rerun.addEventListener("click", () => vscode.postMessage({ type: "rerun" }));
  header.appendChild(rerun);
  root.appendChild(header);

  const bars = el("div", "category-bars");
  (Object.keys(report.categories) as AuditCategory[]).forEach((category) => {
    const { score, max } = report.categories[category];
    const row = el("div", "category-row");
    row.appendChild(el("div", "category-label", `${CATEGORY_LABEL[category]}: ${score}/${max}`));
    const track = el("div", "category-track");
    const fill = el("div", "category-fill");
    fill.style.width = `${max > 0 ? (score / max) * 100 : 0}%`;
    fill.dataset.category = category;
    track.appendChild(fill);
    row.appendChild(track);
    bars.appendChild(row);
  });
  root.appendChild(bars);

  const table = el("div", "rule-table");
  const sorted = [...report.ruleResults].sort((a, b) => a.rule.id.localeCompare(b.rule.id));
  for (const ruleResult of sorted) {
    table.appendChild(renderRuleRow(ruleResult));
  }
  root.appendChild(table);
}

function renderRuleRow(ruleResult: AuditRuleResult): HTMLElement {
  const row = el("div", "rule-row" + (ruleResult.off ? " rule-off" : ""));

  const summary = el("div", "rule-summary");
  summary.appendChild(el("span", "rule-id", ruleResult.rule.id));
  summary.appendChild(el("span", "rule-title", ruleResult.rule.title));
  summary.appendChild(el("span", `severity-badge severity-${ruleResult.rule.severity}`, ruleResult.rule.severity));
  summary.appendChild(
    el(
      "span",
      "rule-count",
      ruleResult.off ? "off" : `${ruleResult.findings.length}/${ruleResult.eligible}`
    )
  );
  row.appendChild(summary);

  if (!ruleResult.off && ruleResult.findings.length > 0) {
    const list = el("div", "finding-list");
    for (const finding of ruleResult.findings) {
      const item = el("button", "finding-item", finding.message);
      item.type = "button";
      item.addEventListener("click", () => vscode.postMessage({ type: "reveal", pointer: finding.pointer }));
      list.appendChild(item);
    }
    row.appendChild(list);
  }

  return row;
}

window.addEventListener("message", (event: MessageEvent<ReportMessage>) => {
  const msg = event.data;
  if (msg && msg.type === "report") {
    render(msg.report);
  }
});

vscode.postMessage({ type: "ready" });
