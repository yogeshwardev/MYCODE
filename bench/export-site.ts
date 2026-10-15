// Publish benchmark results on the website:
//   npx tsx bench/export-site.ts [results.json ...] --model "gpt-oss:120b via Ollama"
// With no files, the latest file in bench/results/ is used. Several files are
// merged (e.g. a run that was resumed). Writes website/benchmarks.json and the
// static HTML between the bench/stats markers in website/index.html, so the
// numbers are visible without JavaScript (crawlers, link previews).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { priceOf } from "../src/agent/events.js";

interface Result {
  task: string;
  category: string;
  runner: string;
  run: number;
  passed: boolean;
  seconds: number;
  tokens?: number;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const resultsDir = path.join(here, "results");
let files = args.filter((a) => a.endsWith(".json") && a !== opt("--model"));
if (!files.length) files = [path.join(resultsDir, fs.readdirSync(resultsDir).filter((f) => f.endsWith(".json")).sort().pop()!)];
const results: Result[] = files.flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8")) as Result[]);
const tasks: Array<{ id: string; category: string }> = JSON.parse(fs.readFileSync(path.join(here, "tasks.json"), "utf8"));
const model = opt("--model") ?? "gpt-oss:120b (Ollama Cloud)";

const NAMES: Record<string, string> = { "swarmcode:agent": "SwarmCode · Agent", "swarmcode:swarm": "SwarmCode · Swarm", opencode: "opencode", codex: "Codex CLI" };
const TITLES: Record<string, string> = {
  "mini-fix-bug": "Fix a date bug",
  "shop-discount-bug": "Fix cents rounding",
  "shop-email-validation": "Email validation",
  "shop-rename": "Rename across codebase",
  "mini-multi-module": "Functions across 3 modules",
  "shop-pagination": "Pagination + callers",
  "shop-orders-csv": "CSV export",
  "shop-inventory": "Stock + cancellations",
  "shop-four-features": "4 store features",
  "ds-four-structures": "4 data structures",
  "utils-eight-functions": "8 utility functions",
  "shop-reports": "3-report module",
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const order = ["swarmcode:agent", "swarmcode:swarm", "codex", "opencode"];
const runners = [...new Set(results.map((r) => r.runner))].sort((a, b) => (order.indexOf(a) + 99) % 99 - ((order.indexOf(b) + 99) % 99));
const runsPerTask = Math.max(...results.map((r) => r.run));

const summary = runners.map((runner) => {
  const rs = results.filter((r) => r.runner === runner);
  const byCategory: Record<string, { passed: number; total: number }> = {};
  for (const cat of ["small", "medium", "large"]) {
    const c = rs.filter((r) => r.category === cat);
    if (c.length) byCategory[cat] = { passed: c.filter((r) => r.passed).length, total: c.length };
  }
  const tok = rs.filter((r) => typeof r.tokens === "number").map((r) => r.tokens!);
  return {
    runner,
    name: NAMES[runner] ?? runner,
    passed: rs.filter((r) => r.passed).length,
    total: rs.length,
    avgSeconds: avg(rs.map((r) => r.seconds)),
    medianTokens: median(tok),
    tokensReported: tok.length === rs.length,
    byCategory,
  };
});

const taskRows = tasks
  .filter((t) => results.some((r) => r.task === t.id))
  .map((t) => ({
    id: t.id,
    title: TITLES[t.id] ?? t.id,
    category: t.category,
    results: runners.map((runner) => {
      const rs = results.filter((x) => x.task === t.id && x.runner === runner);
      const tok = rs.filter((r) => typeof r.tokens === "number").map((r) => r.tokens!);
      return {
        runner,
        passed: rs.filter((r) => r.passed).length,
        runs: rs.length,
        seconds: rs.length ? Math.round(avg(rs.map((r) => r.seconds))!) : null,
        tokens: tok.length ? Math.round(avg(tok)!) : null,
      };
    }),
  }));

// Cost of a typical (median) medium task in agent mode, at Sonnet-class prices.
// The harness records total tokens; agent runs are ~96% input, so price them that way.
const sonnet = priceOf("anthropic/claude-sonnet-5-5")!;
const mediumTokens = median(results.filter((r) => r.runner === "swarmcode:agent" && r.category === "medium" && r.tokens).map((r) => r.tokens!));
const mediumCost = mediumTokens === null ? null : (mediumTokens * 0.96 * sonnet[0] + mediumTokens * 0.04 * sonnet[1]) / 1e6;

// Tokens vs Codex on tasks where both reported them.
let tokenRatio: { ratio: number; name: string } | null = null;
for (const runner of runners.filter((r) => r.startsWith("swarmcode"))) {
  let mine = 0;
  let theirs = 0;
  for (const t of taskRows) {
    const a = t.results.find((x) => x.runner === runner)?.tokens;
    const b = t.results.find((x) => x.runner === "codex")?.tokens;
    if (a && b) {
      mine += a;
      theirs += b;
    }
  }
  if (mine && theirs && (!tokenRatio || theirs / mine > tokenRatio.ratio)) tokenRatio = { ratio: theirs / mine, name: NAMES[runner] ?? runner };
}

const generatedAt = new Date(Math.max(...files.map((f) => fs.statSync(f).mtimeMs))).toISOString();
const note =
  runsPerTask > 1
    ? `${runsPerTask} runs per task and tool, same model for every tool, graded by hidden acceptance tests the agents never saw.`
    : "One run per task and tool, same model for every tool, graded by hidden acceptance tests the agents never saw. Single runs vary, so treat small differences as noise.";
const data = { generatedAt, model, note, runsPerTask, runners: summary, tasks: taskRows, mediumTokens, mediumCostUsd: mediumCost, tokenRatio };
fs.writeFileSync(path.join(here, "..", "website", "benchmarks.json"), JSON.stringify(data, null, 2));

// ---- Static HTML ----
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fmtS = (s: number | null) => (s == null ? "–" : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
const fmtT = (t: number | null) => (t == null ? "n/a" : t >= 1e6 ? `${(t / 1e6).toFixed(1)}M` : t >= 1000 ? `${Math.round(t / 1000)}k` : String(Math.round(t)));
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const when = new Date(generatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

const headline = `<p class="bench-headline">Tasks passed, same model (${esc(model)}): ${summary.map((r) => `<b>${esc(r.name)} ${r.passed}/${r.total}</b>`).join(" · ")}.</p>`;
const cards = summary
  .map((r) => {
    const us = r.runner.startsWith("swarmcode");
    const pct = r.total ? Math.round((r.passed / r.total) * 100) : 0;
    return `<div class="bcard${us ? " us" : ""}">
  <div class="name"><span>${esc(r.name)}</span>${us ? '<span class="tag">ours</span>' : ""}</div>
  <div class="big">${r.passed}<small> / ${r.total} passed</small></div>
  <div class="bar"><i style="width:${pct}%"></i></div>
  <dl>
    <dt>Avg time</dt><dd>${fmtS(r.avgSeconds)}</dd>
    <dt>Median tokens</dt><dd>${r.medianTokens == null ? "not reported" : fmtT(r.medianTokens)}</dd>
    ${(["small", "medium", "large"] as const).filter((c) => r.byCategory[c]).map((c) => `<dt>${cap(c)} tasks</dt><dd>${r.byCategory[c].passed}/${r.byCategory[c].total}</dd>`).join("")}
  </dl>
</div>`;
  })
  .join("\n");
const cell = (x: (typeof taskRows)[number]["results"][number]) => {
  if (!x.runs) return `<td class="res"><span class="t">–</span></td>`;
  const ok = x.passed === x.runs;
  const label = x.runs > 1 ? `${x.passed}/${x.runs}` : ok ? "✓ pass" : "✗ fail";
  return `<td class="res"><span class="${ok ? "ok" : x.passed ? "part" : "no"}">${label}</span><span class="t">${fmtS(x.seconds)}${x.tokens != null ? ` · ${fmtT(x.tokens)} tok` : ""}</span></td>`;
};
const table = `<table class="bench-table" id="bench-table">
  <caption class="sr-only">Results per task</caption>
  <thead><tr><th>Task</th>${summary.map((r) => `<th>${esc(r.name)}</th>`).join("")}</tr></thead>
  <tbody>
${taskRows.map((t) => `    <tr><td class="task">${esc(t.title)}<span class="cat">${t.category}</span></td>${t.results.map(cell).join("")}</tr>`).join("\n")}
  </tbody>
</table>`;
const cost =
  mediumTokens && mediumCost != null
    ? `<p class="bench-cost"><b>What it costs:</b> a typical medium task used about ${fmtT(mediumTokens)} tokens in agent mode. That is roughly $${mediumCost.toFixed(2)} at Sonnet-class API prices before prompt caching (caching lowers it), and $0 with local models through Ollama. Swarm and best-of-3 modes use more; SwarmCode shows the estimate and asks before using them.</p>`
    : "";
const meta = `<p>Model for every tool: <b>${esc(model)}</b>. Run on ${esc(when)}. ${esc(note)} Token counts are shown where a tool reports them; opencode does not.</p>`;
const bench = `${headline}\n<div id="bench-cards" class="bench-cards">\n${cards}\n</div>\n<div class="bench-table-wrap">\n${table}\n</div>\n${cost}\n<div class="bench-notes">\n${meta}`;

const best = [...summary].filter((r) => r.runner.startsWith("swarmcode")).sort((a, b) => b.passed - a.passed)[0];
const stats = [
  tokenRatio && tokenRatio.ratio >= 1.2
    ? `<div><b>${tokenRatio.ratio.toFixed(1)}× fewer</b><span>tokens than Codex CLI on the same tasks (${esc(tokenRatio.name)})</span></div>`
    : `<div><b>Lean</b><span>context: journals and recall instead of re-reading</span></div>`,
  best ? `<div><b>${best.passed}/${best.total}</b><span>real tasks passed, graded by hidden tests (${esc(best.name)})</span></div>` : "",
].join("\n");

const indexFile = path.join(here, "..", "website", "index.html");
let html = fs.readFileSync(indexFile, "utf8");
const put = (name: string, content: string) => {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(html)) throw new Error(`Marker ${name} not found in index.html`);
  html = html.replace(re, `$1\n${content}\n$2`);
};
put("bench", bench);
put("stats", stats);
fs.writeFileSync(indexFile, html);
console.log(`Wrote website/benchmarks.json and index.html from ${files.map((f) => path.basename(f)).join(", ")} (${results.length} runs)`);
