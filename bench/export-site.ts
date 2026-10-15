// Turn a benchmark results file into website/benchmarks.json:
//   npx tsx bench/export-site.ts [bench/results/<file>.json] --model "gpt-oss:120b via Ollama"
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface Result {
  task: string;
  category: string;
  runner: string;
  run: number;
  passed: boolean;
  seconds: number;
  tokens?: number;
  error?: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const resultsDir = path.join(here, "results");
const file =
  args.find((a) => a.endsWith(".json")) ??
  path.join(resultsDir, fs.readdirSync(resultsDir).filter((f) => f.endsWith(".json")).sort().pop()!);
const results: Result[] = JSON.parse(fs.readFileSync(file, "utf8"));
const tasks: Array<{ id: string; category: string; prompt: string }> = JSON.parse(fs.readFileSync(path.join(here, "tasks.json"), "utf8"));

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
const runners = [...new Set(results.map((r) => r.runner))];
const summary = runners.map((runner) => {
  const rs = results.filter((r) => r.runner === runner);
  const byCategory: Record<string, { passed: number; total: number; avgSeconds: number | null }> = {};
  for (const cat of ["small", "medium", "large"]) {
    const c = rs.filter((r) => r.category === cat);
    if (c.length) byCategory[cat] = { passed: c.filter((r) => r.passed).length, total: c.length, avgSeconds: avg(c.map((r) => r.seconds)) };
  }
  const tok = rs.filter((r) => typeof r.tokens === "number").map((r) => r.tokens!);
  return {
    runner,
    name: NAMES[runner] ?? runner,
    passed: rs.filter((r) => r.passed).length,
    total: rs.length,
    avgSeconds: avg(rs.map((r) => r.seconds)),
    avgSecondsPassed: avg(rs.filter((r) => r.passed).map((r) => r.seconds)),
    avgTokens: tok.length ? avg(tok) : null,
    tokensReported: tok.length === rs.length,
    byCategory,
  };
});

const out = {
  generatedAt: new Date(fs.statSync(file).mtime).toISOString(),
  model: opt("--model") ?? "gpt-oss:120b (Ollama Cloud)",
  note: "One run per task and runner, same model for every runner, graded by hidden acceptance tests the agents never saw.",
  runners: summary,
  tasks: tasks
    .filter((t) => results.some((r) => r.task === t.id))
    .map((t) => ({
      id: t.id,
      title: TITLES[t.id] ?? t.id,
      category: t.category,
      results: runners.map((runner) => {
        const r = results.find((x) => x.task === t.id && x.runner === runner);
        return r ? { runner, passed: r.passed, seconds: Math.round(r.seconds), tokens: r.tokens ?? null } : { runner, passed: null, seconds: null, tokens: null };
      }),
    })),
};
const dest = path.join(here, "..", "website", "benchmarks.json");
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(`Wrote ${path.relative(process.cwd(), dest)} from ${path.basename(file)} (${results.length} runs)`);
