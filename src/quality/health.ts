import fs from "node:fs";
import path from "node:path";
import { scan } from "../tools/security.js";
import { git } from "../swarm/git.js";
import { listFiles, run, runShell } from "../util.js";

// Repo health radar: a fast, model-free scan of the project's risk signals.
// Each problem comes with a ready-made task (fixPrompt) the user can hand to
// an agent or the parallel pipeline with one click.

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface HealthItem {
  area: "security" | "dependencies" | "tests" | "maintainability" | "churn";
  severity: Severity;
  title: string;
  detail: string;
  /** A task for SwarmCode that fixes this, if it is actionable. */
  fixPrompt?: string;
}

export interface HealthReport {
  score: number;
  generatedAt: string;
  items: HealthItem[];
  stats: { files: number; sourceFiles: number; testFiles: number };
}

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|rb|php|swift|c|cc|cpp|h|hpp|scala|vue|svelte)$/i;
const TEST = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|_test\.(go|py)$|^test_.*\.py$/i;
const PENALTY: Record<Severity, number> = { critical: 25, high: 12, medium: 5, low: 2, info: 0 };

async function npmAudit(root: string): Promise<HealthItem[]> {
  if (!fs.existsSync(path.join(root, "package-lock.json"))) return [];
  const r = await runShell("npm audit --json --omit=dev", root, 90_000);
  try {
    const v = JSON.parse(r.stdout).metadata?.vulnerabilities as Record<string, number> | undefined;
    if (!v) return [];
    const serious = (v.critical ?? 0) + (v.high ?? 0);
    const total = Object.entries(v).filter(([k]) => k !== "total" && k !== "info").reduce((n, [, c]) => n + c, 0);
    if (!total) return [{ area: "dependencies", severity: "info", title: "No known vulnerable production dependencies", detail: "npm audit found nothing." }];
    return [
      {
        area: "dependencies",
        severity: v.critical ? "critical" : v.high ? "high" : "medium",
        title: `${total} vulnerable production dependenc${total === 1 ? "y" : "ies"} (${serious} critical/high)`,
        detail: Object.entries(v).filter(([k, c]) => k !== "total" && c).map(([k, c]) => `${c} ${k}`).join(", "),
        fixPrompt: "Use the dependency-audit skill: run npm audit, triage which vulnerable packages are reachable in production, and upgrade them with the smallest safe version bumps. Run the tests after each upgrade.",
      },
    ];
  } catch {
    return [];
  }
}

async function pipAudit(root: string): Promise<HealthItem[]> {
  if (!fs.existsSync(path.join(root, "requirements.txt"))) return [];
  const has = await run("pip-audit", ["--version"], { cwd: root });
  if (has.code !== 0) return [{ area: "dependencies", severity: "info", title: "Python dependencies not audited", detail: "Install pip-audit to check requirements.txt for known vulnerabilities." }];
  const r = await run("pip-audit", ["-r", "requirements.txt", "-f", "json"], { cwd: root, timeoutMs: 120_000 });
  try {
    const deps = JSON.parse(r.stdout).dependencies as Array<{ name: string; vulns: unknown[] }>;
    const bad = deps.filter((d) => d.vulns?.length);
    if (!bad.length) return [];
    return [{ area: "dependencies", severity: "high", title: `${bad.length} vulnerable Python package(s)`, detail: bad.map((d) => d.name).slice(0, 10).join(", "), fixPrompt: "Use the dependency-audit skill to upgrade the vulnerable Python packages reported by pip-audit, then run the tests." }];
  } catch {
    return [];
  }
}

function testCommand(root: string, configured?: string): string | undefined {
  if (configured) return configured;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const t = pkg.scripts?.test as string | undefined;
    if (t && !/no test specified/.test(t)) return "npm test";
  } catch {
    /* not a node project */
  }
  if (fs.existsSync(path.join(root, "pytest.ini")) || fs.existsSync(path.join(root, "pyproject.toml"))) return "python -m pytest -q";
  if (fs.existsSync(path.join(root, "go.mod"))) return "go test ./...";
  if (fs.existsSync(path.join(root, "Cargo.toml"))) return "cargo test";
  return undefined;
}

export async function healthCheck(root: string, opts: { runTests?: boolean; testCommand?: string; isRepo?: boolean } = {}): Promise<HealthReport> {
  const files = await listFiles(root);
  const source = files.filter((f) => SOURCE.test(f));
  const tests = source.filter((f) => TEST.test(f));
  const items: HealthItem[] = [];

  // Security: secrets and risky patterns.
  const findings = await scan(root);
  const secrets = findings.filter((f) => f.kind === "secret");
  const highCode = findings.filter((f) => f.kind === "code" && f.severity === "high");
  if (secrets.length) {
    items.push({
      area: "security",
      severity: "critical",
      title: `${secrets.length} possible hardcoded secret(s)`,
      detail: secrets.slice(0, 6).map((f) => `${f.file}:${f.line} ${f.title}`).join("; "),
      fixPrompt: `Use the secrets-hygiene skill. Possible hardcoded secrets were found at: ${secrets.map((f) => `${f.file}:${f.line}`).join(", ")}. Confirm which are real, move them to environment variables with a .env.example, and list which credentials must be rotated.`,
    });
  }
  if (highCode.length) {
    items.push({
      area: "security",
      severity: "high",
      title: `${highCode.length} high-severity risky code pattern(s)`,
      detail: highCode.slice(0, 6).map((f) => `${f.file}:${f.line} ${f.title}`).join("; "),
      fixPrompt: `Use the security-review skill on these locations and fix the confirmed vulnerabilities with regression tests (secure-fix skill): ${highCode.map((f) => `${f.file}:${f.line} (${f.title})`).join(", ")}.`,
    });
  }
  const medium = findings.filter((f) => f.kind === "code" && f.severity === "medium").length;
  if (medium) items.push({ area: "security", severity: "low", title: `${medium} medium-severity pattern(s) to review`, detail: "Run `swarm --skill security-review` for a full review." });

  // Dependencies.
  items.push(...(await npmAudit(root)), ...(await pipAudit(root)));

  // Tests.
  if (source.length && !tests.length) {
    items.push({ area: "tests", severity: "high", title: "No automated tests found", detail: `${source.length} source files and no test files.`, fixPrompt: "Use the test-writing skill: set up the standard test framework for this project and add tests for the most important business logic first." });
  } else if (source.length) {
    const ratio = tests.length / Math.max(1, source.length - tests.length);
    if (ratio < 0.1) items.push({ area: "tests", severity: "medium", title: "Few tests for the amount of code", detail: `${tests.length} test file(s) for ${source.length - tests.length} source file(s).`, fixPrompt: "Use the test-writing skill to add tests for the least-tested core modules, starting with business logic and error paths." });
  }
  const cmd = testCommand(root, opts.testCommand);
  if (opts.runTests && cmd) {
    const started = Date.now();
    const r = await runShell(cmd, root, 600_000);
    const secs = Math.round((Date.now() - started) / 1000);
    items.push(
      r.code === 0
        ? { area: "tests", severity: "info", title: `Tests pass (${cmd}, ${secs}s)`, detail: "" }
        : { area: "tests", severity: "high", title: `Tests fail (${cmd})`, detail: (r.stdout + r.stderr).split("\n").filter((l) => /fail|error|✖|not ok/i.test(l)).slice(0, 4).join(" | "), fixPrompt: `The test command \`${cmd}\` fails. Use the debugging skill to find the root causes and fix them without weakening tests.` },
    );
  } else if (!cmd && source.length) items.push({ area: "tests", severity: "low", title: "No test command detected", detail: "Set verifyCommand in .swarmcode/config.json so agents can verify their work." });

  // Maintainability: very large files and TODO debt.
  const large: Array<[string, number]> = [];
  const todos = new Map<string, number>();
  for (const f of source) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(root, f), "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n").length;
    if (lines > 800) large.push([f, lines]);
    const n = (text.match(/\b(TODO|FIXME|HACK|XXX)\b/g) ?? []).length;
    if (n) todos.set(f, n);
  }
  if (large.length) {
    large.sort((a, b) => b[1] - a[1]);
    items.push({ area: "maintainability", severity: "low", title: `${large.length} very large file(s)`, detail: large.slice(0, 5).map(([f, n]) => `${f} (${n} lines)`).join(", "), fixPrompt: `Use the refactoring skill to split ${large[0][0]} into cohesive modules without changing behavior. Run the tests before and after.` });
  }
  const todoTotal = [...todos.values()].reduce((a, b) => a + b, 0);
  if (todoTotal >= 10) {
    const top = [...todos].sort((a, b) => b[1] - a[1]).slice(0, 5);
    items.push({ area: "maintainability", severity: "info", title: `${todoTotal} TODO/FIXME markers`, detail: top.map(([f, n]) => `${f} (${n})`).join(", ") });
  }

  // Churn: files changed most often recently are where bugs concentrate.
  if (opts.isRepo !== false) {
    const log = await git(root, ["log", "--since=90.days", "--name-only", "--pretty=format:"]);
    if (log.code === 0) {
      const counts = new Map<string, number>();
      for (const f of log.stdout.split("\n").filter((l) => SOURCE.test(l))) counts.set(f, (counts.get(f) ?? 0) + 1);
      const hot = [...counts].filter(([f, n]) => n >= 8 && fs.existsSync(path.join(root, f))).sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (hot.length) items.push({ area: "churn", severity: "info", title: "Change hotspots (last 90 days)", detail: hot.map(([f, n]) => `${f} (${n} commits)`).join(", ") });
    }
  }

  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);
  const score = Math.max(0, 100 - items.reduce((n, i) => n + PENALTY[i.severity], 0));
  return { score, generatedAt: new Date().toISOString(), items, stats: { files: files.length, sourceFiles: source.length, testFiles: tests.length } };
}

export function renderHealth(r: HealthReport): string {
  const icon: Record<Severity, string> = { critical: "✖✖", high: "✖ ", medium: "! ", low: "· ", info: "  " };
  const lines = [`Health score: ${r.score}/100  (${r.stats.sourceFiles} source files, ${r.stats.testFiles} test files)`, ""];
  for (const i of r.items) {
    lines.push(`${icon[i.severity]} [${i.severity}] ${i.area}: ${i.title}`);
    if (i.detail) lines.push(`     ${i.detail}`);
  }
  const fixes = r.items.filter((i) => i.fixPrompt).length;
  if (fixes) lines.push("", `${fixes} item(s) can be fixed automatically: run \`swarm health --fix\` or use the Health tab in the desktop app.`);
  return lines.join("\n");
}
