import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validatePlan, type Plan } from "../src/swarm/planner.js";
import { CORE_TOOLS, validateInput } from "../src/tools/index.js";
import { clip, confine, globToRegExp } from "../src/util.js";
import { resolveProject } from "../src/swarm/git.js";
import { announcesNextStep } from "../src/agent/agent.js";
import { execFileSync } from "node:child_process";

test("globToRegExp", () => {
  assert.ok(globToRegExp("src/**/*.ts").test("src/a/b/c.ts"));
  assert.ok(globToRegExp("src/**/*.ts").test("src/c.ts"));
  assert.ok(!globToRegExp("src/*.ts").test("src/a/c.ts"));
  assert.ok(globToRegExp("*.json").test("deep/dir/package.json"));
  assert.ok(globToRegExp("*.{js,ts}").test("x.js"));
  assert.ok(!globToRegExp("*.{js,ts}").test("x.py"));
});

test("confine rejects escapes", () => {
  const root = path.resolve("/tmp/proj");
  assert.equal(confine(root, "a/b.txt"), path.join(root, "a", "b.txt"));
  assert.throws(() => confine(root, "../etc/passwd"));
  assert.throws(() => confine(root, path.resolve("/elsewhere")));
});

test("clip keeps head and tail", () => {
  const s = "A".repeat(100) + "B".repeat(100);
  const out = clip(s, 50);
  assert.ok(out.startsWith("A") && out.endsWith("B") && out.includes("omitted"));
});

const task = (id: string, files: string[], deps: string[] = []) => ({ id, title: id, description: "do " + id, files, depends_on: deps });

test("validatePlan catches cycles, unknown deps and parallel file clashes", () => {
  const ok: Plan = { summary: "s", tasks: [task("a", ["x.ts"]), task("b", ["y.ts"]), task("c", ["x.ts"], ["a"])] };
  assert.equal(validatePlan(ok), undefined);
  assert.match(validatePlan({ summary: "s", tasks: [task("a", [], ["b"]), task("b", [], ["a"])] })!, /cycle/);
  assert.match(validatePlan({ summary: "s", tasks: [task("a", [], ["zzz"])] })!, /unknown/);
  assert.match(validatePlan({ summary: "s", tasks: [task("a", ["x.ts"]), task("b", ["x.ts"])] })!, /parallel/);
});

test("edit_file: exact, unique replacement that preserves CRLF", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcode-"));
  fs.writeFileSync(path.join(dir, "f.txt"), "one\r\ntwo\r\ntwo\r\n");
  const edit = CORE_TOOLS.find((t) => t.spec.name === "edit_file")!;
  const ctx = { root: dir, approve: async () => true };
  await assert.rejects(edit.run({ path: "f.txt", old_string: "two", new_string: "2" }, ctx), /2 times/);
  await edit.run({ path: "f.txt", old_string: "one\ntwo", new_string: "1\ntwo" }, ctx);
  assert.equal(fs.readFileSync(path.join(dir, "f.txt"), "utf8"), "1\r\ntwo\r\ntwo\r\n");
});

test("validateInput", () => {
  const spec = CORE_TOOLS.find((t) => t.spec.name === "read_file")!.spec;
  assert.match(validateInput(spec, {})!, /Missing/);
  assert.match(validateInput(spec, { path: 3 })!, /string/);
  assert.equal(validateInput(spec, { path: "a", offset: 2 }), undefined);
});

test("read_file returns a short notice for unchanged re-reads", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcode-"));
  fs.writeFileSync(path.join(dir, "a.txt"), "hello\nworld\n");
  const read = CORE_TOOLS.find((t) => t.spec.name === "read_file")!;
  const edit = CORE_TOOLS.find((t) => t.spec.name === "edit_file")!;
  const ctx = { root: dir, approve: async () => true, readCache: new Map<string, string>() };
  assert.match(await read.run({ path: "a.txt" }, ctx), /hello/);
  assert.match(await read.run({ path: "a.txt" }, ctx), /unchanged/);
  await edit.run({ path: "a.txt", old_string: "world", new_string: "there" }, ctx);
  assert.match(await read.run({ path: "a.txt" }, ctx), /there/);
});

test("edit_file applies multiple edits atomically and shows the result", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcode-"));
  fs.writeFileSync(path.join(dir, "m.ts"), "const a = 1;\nconst b = 2;\n");
  const edit = CORE_TOOLS.find((t) => t.spec.name === "edit_file")!;
  const ctx = { root: dir, approve: async () => true };
  const out = await edit.run({ path: "m.ts", edits: [{ old_string: "a = 1", new_string: "a = 10" }, { old_string: "b = 2", new_string: "b = 20" }] }, ctx);
  assert.match(out, /2 changes/);
  assert.match(out, /1\tconst a = 10;/);
  // A failing edit in a batch changes nothing.
  await assert.rejects(edit.run({ path: "m.ts", edits: [{ old_string: "a = 10", new_string: "a = 0" }, { old_string: "nope", new_string: "x" }] }, ctx), /Edit 2/);
  assert.equal(fs.readFileSync(path.join(dir, "m.ts"), "utf8"), "const a = 10;\nconst b = 20;\n");
});

test("grep finds matches (ripgrep or fallback)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcode-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "x.ts"), "export function findMe() {}\n");
  fs.writeFileSync(path.join(dir, "y.md"), "findMe in docs\n");
  const grep = CORE_TOOLS.find((t) => t.spec.name === "grep")!;
  const ctx = { root: dir, approve: async () => true };
  const all = await grep.run({ pattern: "findMe" }, ctx);
  assert.match(all, /src\/x\.ts:1: export function findMe/);
  const onlyTs = await grep.run({ pattern: "findMe", glob: "*.ts" }, ctx);
  assert.ok(!onlyTs.includes("y.md"));
});

test("UsageTracker enforces a budget", async () => {
  const { UsageTracker, BudgetExceededError } = await import("../src/agent/events.js");
  const u = new UsageTracker(0.01, { "x/y": [10, 10, 1] });
  u.checkBudget();
  u.add("x/y", { input: 2000, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.throws(() => u.checkBudget(), BudgetExceededError);
});

test("VERSION matches package.json", async () => {
  const { VERSION } = await import("../src/version.js");
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION, pkg.version);
});

test("normalizePlan accepts common field-name variants", async () => {
  const { normalizePlan } = await import("../src/swarm/planner.js");
  const plan = normalizePlan({
    overview: "x",
    tasks: [{ name: "Add Utils", details: "do it", dependencies: "", owned_files: ["a.ts"] }],
  });
  assert.equal(plan.summary, "x");
  assert.deepEqual(plan.tasks[0], { id: "add-utils", title: "Add Utils", description: "do it", files: ["a.ts"], depends_on: [] });
  assert.equal(validatePlan(plan), undefined);
});

test("security_scan finds secrets (masked) and risky code", async () => {
  const { scan } = await import("../src/tools/security.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcode-sec-"));
  fs.writeFileSync(path.join(dir, "config.js"), 'const key = "AKIAABCDEFGHIJKLMNOP";\nconst db = "postgres://admin:hunter2pass@db:5432/app";\n');
  fs.writeFileSync(path.join(dir, "app.js"), 'db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);\nel.innerHTML = userInput;\n');
  fs.writeFileSync(path.join(dir, "tool.py"), "import subprocess\nsubprocess.run(cmd, shell=True)\nrequests.get(url, verify=False)\n");
  fs.writeFileSync(path.join(dir, "safe.js"), "const x = 1;\n");
  const findings = await scan(dir);
  const ids = new Set(findings.map((f) => f.rule));
  for (const id of ["aws-key", "url-credentials", "js-sqli", "js-xss", "py-shell-true", "py-tls-off"]) assert.ok(ids.has(id), `missing ${id}`);
  assert.ok(!findings.some((f) => f.file === "safe.js"));
  const aws = findings.find((f) => f.rule === "aws-key")!;
  assert.ok(!aws.excerpt.includes("AKIAABCDEFGHIJKLMNOP"), "secret must be masked");
  assert.equal(findings[0].severity, "high");
});

test("skills: built-ins load and frontmatter parses", async () => {
  const { loadSkills, parseSkill } = await import("../src/skills.js");
  const skills = loadSkills(fs.mkdtempSync(path.join(os.tmpdir(), "swarmcode-sk-")));
  const names = skills.map((s) => s.name);
  for (const n of ["security-review", "threat-model", "secure-fix", "detection-engineering", "debugging"]) assert.ok(names.includes(n), n);
  assert.equal(parseSkill("no frontmatter", "user"), undefined);
  assert.deepEqual(parseSkill("---\nname: x\ndescription: y\n---\nbody", "project"), { name: "x", description: "y", triggers: [], body: "body", source: "project" });
});

test("htmlToText strips markup and scripts", async () => {
  const { htmlToText } = await import("../src/tools/web.js");
  assert.equal(htmlToText("<html><head><title>t</title></head><body><script>evil()</script><h1>Hi</h1><p>a &amp; b</p></body></html>"), "Hi\na & b");
});

test("journal recall finds earlier details; offload keeps context small", async () => {
  const { Journal, makeRecallTool, offload } = await import("../src/agent/journal.js");
  const j = new Journal();
  j.add("request", "fix the login bug");
  j.add("tool", "read_file src/auth.ts\n42 export function verifyToken(t) { return jwt.verify(t, SECRET) }");
  j.add("tool", "bash npm test\nAll 12 tests passed");
  const out = await makeRecallTool(j).run({ query: "verifyToken" }, { root: ".", approve: async () => true });
  assert.match(out, /jwt\.verify/);
  assert.doesNotMatch(out, /All 12 tests/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcode-off-"));
  const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n");
  const small = offload(big, dir, "worker-bash");
  assert.ok(small.length < 8000, `offloaded view is ${small.length} chars`);
  const saved = /saved at (\S+);/.exec(small)![1];
  assert.equal(fs.readFileSync(path.join(dir, saved), "utf8"), big);
  assert.equal(offload("short", dir, "x"), "short");
});

test("a folder inside a git repo at the home directory is its own project", async () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sc-home-")));
  execFileSync("git", ["init", "-q"], { cwd: home });
  const sub = path.join(home, "work", "app");
  fs.mkdirSync(sub, { recursive: true });
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = process.env.USERPROFILE = home;
  try {
    assert.deepEqual(await resolveProject(sub), { root: path.resolve(sub), isRepo: false, homeRepo: true });
    // Opening the home folder itself still uses the repo.
    assert.equal((await resolveProject(home)).isRepo, true);
  } finally {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("detects replies that stop while announcing a next step", () => {
  for (const t of ["The error persists. Let's check the console.", "Done with the HTML.\nI'll now write the tests.", "Maybe the regex is wrong? Could use browser_console to check."])
    assert.equal(announcesNextStep(t), true, t);
  for (const t of ["All 12 checks pass. The login page is ready.", "I added validation. Let me know if you want a light theme.", "Which database do you use? Should I add Postgres?", ""])
    assert.equal(announcesNextStep(t), false, t);
});
