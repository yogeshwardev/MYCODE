// A scripted stand-in for the Electron backend so the UI can be developed and
// checked in a plain browser: `npm run preview`, then open dist-preview/renderer/index.html.
import type { NewRequest, Push, SwarmApi, TaskState, UserRequest } from "../shared.js";

const listeners = new Set<(p: Push) => void>();
const emit = (p: Push) => listeners.forEach((l) => l(p));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const answers = new Map<string, (allow: boolean) => void>();
let seq = 0;
const ask = (r: NewRequest) =>
  new Promise<boolean>((resolve) => {
    const id = `m${++seq}`;
    answers.set(id, resolve);
    emit({ type: "request", request: { ...r, id } as UserRequest });
  });

let cost = 0;
const usage = (ctx: number) => {
  cost += 0.011;
  emit({ type: "usage", usage: { costUsd: cost, inputTokens: 48_200 + ctx, outputTokens: 3_900, cachedTokens: 31_000, contextTokens: ctx, contextWindow: 1_000_000 } });
};

const DIFF = `diff --git a/src/api/limits.ts b/src/api/limits.ts
new file mode 100644
--- /dev/null
+++ b/src/api/limits.ts
@@ -0,0 +1,9 @@
+import { RateLimiter } from "./rate";
+
+export const limiter = new RateLimiter({
+  windowMs: 60_000,
+  max: 100,
+});
+
+export const limit = limiter.middleware();
+
diff --git a/src/server.ts b/src/server.ts
--- a/src/server.ts
+++ b/src/server.ts
@@ -3,7 +3,8 @@ import express from "express";
 import { routes } from "./routes";
+import { limit } from "./api/limits";

 const app = express();
-app.use(routes);
+app.use(limit, routes);
 export default app;
`;

const mock: SwarmApi = {
  state: async () => ({
    recent: ["C:\\code\\acme-api", "C:\\code\\web-dashboard"],
    providers: [
      { name: "anthropic", envVar: "ANTHROPIC_API_KEY", source: "app" },
      { name: "openai", envVar: "OPENAI_API_KEY", source: "none" },
      { name: "gemini", envVar: "GEMINI_API_KEY", source: "env" },
      { name: "ollama", source: "local" },
    ],
    secureStorage: true,
    version: "1.0.0",
    platform: "win32",
    account: null,
    signIn: { github: true, google: true },
  }),
  openProject: async () => ({
    root: "C:\\code\\acme-api",
    name: "acme-api",
    isRepo: true,
    models: { main: "anthropic/claude-opus-5-5", planner: "anthropic/claude-opus-5-5", worker: "anthropic/claude-sonnet-5-5", explorer: "anthropic/claude-haiku-5-5" },
    maxParallel: 4,
    mcpTools: 3,
    warnings: [],
  }),
  send: async (prompt) => {
    emit({ type: "event", event: { type: "turn_start", agent: "swarm" } });
    await wait(700);
    emit({ type: "event", event: { type: "turn_end", agent: "swarm" } });
    emit({ type: "event", event: { type: "tool", agent: "swarm", name: "grep", summary: "/app.use/ in **/*.ts" } });
    emit({ type: "event", event: { type: "tool", agent: "swarm", name: "read_file", summary: "src/server.ts" } });
    const ok = await ask({ kind: "approve", approval: "write", summary: "Edit src/server.ts" });
    emit({ type: "event", event: { type: "tool", agent: "swarm", name: "edit_file", summary: "src/server.ts" } });
    if (!ok) emit({ type: "event", event: { type: "tool_error", agent: "swarm", name: "edit_file", error: "User declined the edit." } });
    const reply = `I looked at how middleware is registered in \`src/server.ts\` and ${ok ? "added" : "would add"} the limiter before the routes:\n\n\`\`\`ts\napp.use(limit, routes);\n\`\`\`\n\n**Next steps**\n- Add tests for the 429 response\n- Make the window configurable\n\n(you asked: ${prompt.slice(0, 60)})`;
    for (const chunk of reply.match(/.{1,12}/gs) ?? []) {
      emit({ type: "event", event: { type: "text", agent: "swarm", delta: chunk } });
      await wait(25);
    }
    emit({ type: "event", event: { type: "assistant_done", agent: "swarm" } });
    usage(42_000);
    return { text: reply };
  },
  swarm: async () => {
    emit({ type: "event", event: { type: "status", agent: "swarm", message: "Planning..." } });
    for (const s of ["glob src/**/*.ts", "read_file src/server.ts", "grep /router/"]) {
      emit({ type: "event", event: { type: "tool", agent: "planner", name: s.split(" ")[0], summary: s.split(" ").slice(1).join(" ") } });
      await wait(250);
    }
    const plan = {
      summary: "Add a token-bucket rate limiter as Express middleware, expose per-route limits in config, and cover it with tests. Shared contract: limit(opts) returns middleware.",
      tasks: [
        { id: "limiter", title: "Rate limiter core", description: "", files: ["src/api/rate.ts", "src/api/limits.ts"], depends_on: [] },
        { id: "config", title: "Per-route limit config", description: "", files: ["src/config.ts"], depends_on: [] },
        { id: "docs", title: "API docs for 429 responses", description: "", files: ["docs/api.md"], depends_on: [] },
        { id: "wire-up", title: "Wire middleware into server", description: "", files: ["src/server.ts"], depends_on: ["limiter", "config"] },
      ],
      verify_command: "npm test",
    };
    if (!(await ask({ kind: "plan", plan }))) return { report: "Plan not approved", applied: false, branch: null };
    const states: TaskState[] = plan.tasks.map((task) => ({ task, status: "pending" }));
    const tick = () => emit({ type: "tasks", tasks: structuredClone(states) });
    const run = async (i: number, ms: number) => {
      states[i].status = "running";
      states[i].startedAt = Date.now();
      states[i].model = "anthropic/claude-sonnet-5-5";
      tick();
      for (const s of ["read_file " + plan.tasks[i].files[0], "edit_file " + plan.tasks[i].files[0], "bash npm test -- rate"]) {
        await wait(ms / 3);
        emit({ type: "event", event: { type: "tool", agent: plan.tasks[i].id, name: s.split(" ")[0], summary: s.split(" ").slice(1).join(" ") } });
      }
      states[i].status = "done";
      states[i].changed = true;
      states[i].endedAt = Date.now();
      tick();
      usage(0);
    };
    await Promise.all([run(0, 2600), run(1, 1600), run(2, 1200)]);
    emit({ type: "event", event: { type: "status", agent: "swarm", message: "Merge conflict in src/config.ts; resolving..." } });
    emit({ type: "event", event: { type: "tool", agent: "merge:config", name: "edit_file", summary: "src/config.ts" } });
    await run(3, 1500);
    emit({ type: "event", event: { type: "status", agent: "swarm", message: "Verifying: npm test" } });
    await wait(800);
    emit({ type: "event", event: { type: "status", agent: "swarm", message: "Verification passed." } });
    const report = "✔ limiter: Rate limiter core (9s)\n✔ config: Per-route limit config (5s)\n✔ docs: API docs for 429 responses (4s)\n✔ wire-up: Wire middleware into server (5s)\n\nVerification (npm test): passed";
    emit({ type: "result", report, diff: DIFF });
    const applied = await ask({ kind: "apply", report, diff: DIFF });
    return { report, applied, branch: applied ? null : "swarm/20261013120000" };
  },
  undo: async () => ["src/server.ts"],
  review: async () => {
    await wait(900);
    return {
      approved: false,
      scope: "uncommitted changes",
      feedback: "1. src/api/rate.ts:42: the bucket refills before checking the limit, so a burst of 2× the limit passes on the first second. Check, then refill.\n2. src/api/limits.ts:12: `/health` has no limit entry and falls back to the global default; exempt it explicitly.",
    };
  },
  signIn: async (provider) => {
    if (provider === "github") {
      emit({ type: "device-code", code: "WDJB-MJHT", url: "https://github.com/login/device" });
      await wait(2500);
    }
    return { ...(await mock.state()), account: { provider, name: "Ada Lovelace", login: "ada", email: "ada@example.com" } };
  },
  cancelSignIn: async () => undefined,
  signOut: async () => mock.state(),
  auto: async (goal) => ({ ...(await mock.send(goal)), pick: "agent" }),
  health: async () => ({
    score: 71,
    stats: { files: 48, sourceFiles: 31, testFiles: 9 },
    items: [
      { area: "security", severity: "critical", title: "1 possible hardcoded secret(s)", detail: "src/config.ts:4 AWS access key", fixPrompt: "Use the secrets-hygiene skill on src/config.ts:4." },
      { area: "dependencies", severity: "high", title: "3 vulnerable production dependencies (1 critical/high)", detail: "1 high, 2 moderate", fixPrompt: "Use the dependency-audit skill." },
      { area: "tests", severity: "info", title: "Tests pass (npm test, 6s)", detail: "" },
    ],
  }),
  bestOf: async () => ({ report: "", applied: false, branch: null, winner: null }),
  skills: async () => [
    { name: "security-review", description: "Security code review" },
    { name: "threat-model", description: "Threat modeling" },
    { name: "debugging", description: "Root-cause debugging" },
  ],
  abort: async () => {
    for (const [id, r] of answers) {
      r(false);
      answers.delete(id);
    }
  },
  answer: async (id, a) => {
    answers.get(id)?.(a.allow);
    answers.delete(id);
  },
  newConversation: async () => undefined,
  sessions: async () => [
    { id: "a", title: "Add rate limiting to the public API", updated: new Date().toISOString() },
    { id: "b", title: "Why is the auth test flaky on CI?", updated: new Date(Date.now() - 86_400_000).toISOString() },
  ],
  resume: async () => [
    { role: "user", text: "Why is the auth test flaky on CI?" },
    { role: "assistant", text: "The test depends on wall-clock time in `tokens.test.ts:41`. Freezing the clock fixes it." },
  ],
  workingDiff: async () => DIFF,
  getSettings: async () => ({
    models: { main: "anthropic/claude-opus-5-5", planner: "anthropic/claude-opus-5-5", worker: "anthropic/claude-sonnet-5-5", explorer: "anthropic/claude-haiku-5-5" },
    effort: { main: "high", planner: "high", worker: "medium", explorer: "low" },
    maxParallel: 4,
    verifyCommand: "npm test",
    permission: "ask",
    budgetUsd: null,
  }),
  saveSettings: async () => null,
  setKey: async () => mock.state(),
  openExternal: async () => undefined,
  onPush: (cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

window.swarm = mock;

// Make it impossible to mistake this page for the real app.
document.addEventListener("DOMContentLoaded", () => {
  const banner = document.createElement("div");
  banner.className = "preview-banner";
  banner.textContent = "UI PREVIEW: scripted fake replies, no AI model and no real files. Run the desktop app (npm start in desktop/) to use SwarmCode.";
  document.body.prepend(banner);
});
