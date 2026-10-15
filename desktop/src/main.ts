import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_PROVIDERS, clearModelCache, GLOBAL_CONFIG, loadConfig, SWARMCODE_HOME } from "../../src/config.js";
import { Engine } from "../../src/engine.js";
import { VERSION } from "../../src/version.js";
import { githubFinish, githubStart, googleSignIn, type Account, type OAuthConfig } from "./auth.js";
import type { AppState, ImageAttachment, NewRequest, ProjectInfo, ProviderStatus, Push, RequestAnswer, SendOptions, Settings, UserRequest } from "./shared.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOME_DIR = SWARMCODE_HOME;
const CREDENTIALS = path.join(HOME_DIR, "credentials.json");
const DESKTOP_STATE = path.join(HOME_DIR, "desktop.json");

let win: BrowserWindow | null = null;
let engine: Engine | null = null;
let projectWarnings: string[] = [];
const pending = new Map<string, (a: RequestAnswer) => void>();
let requestSeq = 0;

// ---- persistence -------------------------------------------------------------

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + ".tmp", JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(file + ".tmp", file);
}

/** API keys saved in the app, encrypted with the OS keychain (DPAPI / Keychain / libsecret). */
function loadStoredKeys(): Record<string, string> {
  const raw = readJson<Record<string, string>>(CREDENTIALS, {});
  const keys: Record<string, string> = {};
  for (const [env, value] of Object.entries(raw)) {
    if (env.startsWith("oauth:")) continue;
    try {
      keys[env] = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(value, "base64")) : "";
    } catch {
      /* unreadable on this machine; ignore */
    }
  }
  return keys;
}

const appKeys = new Set<string>();
function applyStoredKeys() {
  for (const [env, key] of Object.entries(loadStoredKeys())) {
    // Keys already set in the environment win; the app never overrides them.
    if (key && (!process.env[env] || appKeys.has(env))) {
      process.env[env] = key;
      appKeys.add(env);
    }
  }
}

function providers(): ProviderStatus[] {
  return Object.entries(BUILTIN_PROVIDERS).map(([name, def]) => ({
    name,
    envVar: def.apiKeyEnv,
    source: !def.apiKeyEnv ? "local" : appKeys.has(def.apiKeyEnv) ? "app" : process.env[def.apiKeyEnv] ? "env" : "none",
  }));
}

function appState(): AppState {
  const cfg = oauthConfig();
  return {
    recent: recentProjects(),
    providers: providers(),
    secureStorage: safeStorage.isEncryptionAvailable(),
    version: VERSION,
    platform: process.platform,
    account: readJson<{ account?: Account }>(DESKTOP_STATE, {}).account ?? null,
    signIn: { github: Boolean(cfg.githubClientId), google: Boolean(cfg.googleClientId) },
  };
}

/** OAuth client IDs: environment variables first, then ~/.swarmcode/desktop.json "oauth". */
function oauthConfig(): OAuthConfig {
  const file = readJson<{ oauth?: OAuthConfig }>(DESKTOP_STATE, {}).oauth ?? {};
  return {
    githubClientId: process.env.SWARMCODE_GITHUB_CLIENT_ID || file.githubClientId,
    googleClientId: process.env.SWARMCODE_GOOGLE_CLIENT_ID || file.googleClientId,
    googleClientSecret: process.env.SWARMCODE_GOOGLE_CLIENT_SECRET || file.googleClientSecret,
  };
}

function saveAccount(account: Account | null, token?: string) {
  writeJson(DESKTOP_STATE, { ...readJson<Record<string, unknown>>(DESKTOP_STATE, {}), account: account ?? undefined });
  const raw = readJson<Record<string, string>>(CREDENTIALS, {});
  delete raw["oauth:github"];
  if (token && safeStorage.isEncryptionAvailable()) raw["oauth:github"] = safeStorage.encryptString(token).toString("base64");
  writeJson(CREDENTIALS, raw);
}

let signInAbort: AbortController | undefined;

function recentProjects(): string[] {
  return readJson<{ recent?: string[] }>(DESKTOP_STATE, {}).recent?.filter((p) => fs.existsSync(p)) ?? [];
}

function remember(root: string) {
  const recent = [root, ...recentProjects().filter((p) => p !== root)].slice(0, 10);
  writeJson(DESKTOP_STATE, { ...readJson(DESKTOP_STATE, {}), recent });
}

// ---- engine --------------------------------------------------------------------

function push(p: Push) {
  win?.webContents.send("push", p);
}

let usageTimer: NodeJS.Timeout | undefined;
function pushUsage() {
  if (usageTimer) return;
  usageTimer = setTimeout(() => {
    usageTimer = undefined;
    if (!engine) return;
    const u = engine.usage.toJSON();
    const ctx = engine.context;
    push({
      type: "usage",
      usage: {
        costUsd: u.costUsd,
        inputTokens: u.totals.input + u.totals.cacheRead + u.totals.cacheWrite,
        outputTokens: u.totals.output,
        cachedTokens: u.totals.cacheRead,
        contextTokens: ctx.tokens,
        contextWindow: ctx.window,
      },
    });
  }, 250);
}

function ask(request: NewRequest): Promise<RequestAnswer> {
  const id = `r${++requestSeq}`;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    push({ type: "request", request: { ...request, id } as UserRequest });
  });
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Images from the renderer: known types, base64 only, at most 5 of up to 5 MB each. */
function validImages(images: unknown): ImageAttachment[] | undefined {
  if (!Array.isArray(images)) return undefined;
  const ok = images
    .filter((i): i is ImageAttachment => typeof i?.mediaType === "string" && typeof i?.data === "string")
    .filter((i) => IMAGE_TYPES.has(i.mediaType) && /^[A-Za-z0-9+/=]+$/.test(i.data) && i.data.length <= 7_000_000)
    .slice(0, 5)
    .map((i) => ({ mediaType: i.mediaType, data: i.data }));
  return ok.length ? ok : undefined;
}

async function openEngine(root: string): Promise<ProjectInfo> {
  if (engine?.busy) throw new Error("Stop the running agent before switching projects.");
  await engine?.close();
  engine = null;
  projectWarnings = [];
  clearModelCache();
  const e: Engine = await Engine.open(root, {
    events: (event) => {
      push({ type: "event", event });
      if (event.type === "turn_end") pushUsage();
    },
    onTasks: (tasks) => {
      push({ type: "tasks", tasks: structuredClone(tasks) });
      pushUsage();
    },
    onWarning: (message) => {
      projectWarnings.push(message);
      push({ type: "warning", message });
    },
    approve: async (kind, summary) => {
      const a = await ask({ kind: "approve", approval: kind, summary });
      if (a.always) e.allowAlways(kind);
      return a.allow;
    },
    confirmPlan: async (plan) => (await ask({ kind: "plan", plan })).allow,
    chooseMode: async (f) => {
      const a = await ask({ kind: "mode", size: f.assessment.size, reason: f.assessment.reason, recommended: f.pick, why: f.why, options: f.options });
      return a.allow ? (a.mode ?? f.pick) : "agent";
    },
    showResult: (report, diff) => push({ type: "result", report, diff }),
    confirmApply: async (report, diff) => (await ask({ kind: "apply", report, diff })).allow,
    ask: async (question, options) => {
      const a = await ask({ kind: "question", question, options });
      return a.allow ? (a.text ?? "") : "";
    },
  });
  engine = e;
  remember(e.root);
  pushUsage();
  return projectInfo();
}

function projectInfo(): ProjectInfo {
  if (!engine) throw new Error("No project is open.");
  return {
    root: engine.root,
    name: path.basename(engine.root),
    isRepo: engine.isRepo,
    models: engine.cfg.models,
    maxParallel: engine.cfg.maxParallel,
    mcpTools: engine.mcp?.tools.length ?? 0,
    warnings: projectWarnings,
  };
}

function need(): Engine {
  if (!engine) throw new Error("Open a project folder first.");
  return engine;
}

// ---- IPC -------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle("state", (): AppState => appState());

  ipcMain.handle("openProject", async (_e, dir?: string) => {
    if (!dir) {
      const r = await dialog.showOpenDialog(win!, { title: "Open a project folder", properties: ["openDirectory", "createDirectory"] });
      if (r.canceled || !r.filePaths[0]) return null;
      dir = r.filePaths[0];
    }
    return openEngine(dir);
  });

  ipcMain.handle("auto", async (_e, goal: string, guarantee?: boolean, skills?: string[]) => {
    const r = await need().auto(goal, { guarantee, skills });
    pushUsage();
    return { text: r.text, pick: r.mode };
  });

  ipcMain.handle("health", (_e, runTests: boolean) => need().health({ runTests }));

  ipcMain.handle("send", async (_e, prompt: string, skills?: string[], guarantee?: boolean, opts?: SendOptions) => {
    const text = await need().send(prompt, { skills, guarantee, plan: opts?.plan === true, images: validImages(opts?.images) });
    pushUsage();
    return { text };
  });

  ipcMain.handle("review", async (_e, focus?: string) => {
    const r = await need().review({ focus: typeof focus === "string" && focus.trim() ? focus.slice(0, 2000) : undefined });
    pushUsage();
    return { approved: r.approved, feedback: r.feedback, scope: r.scope };
  });

  ipcMain.handle("swarm", async (_e, goal: string, guarantee?: boolean) => {
    const r = await need().swarm(goal, { guarantee });
    pushUsage();
    return { report: r.report, applied: r.applied, branch: r.branch ?? null };
  });

  ipcMain.handle("bestOf", async (_e, goal: string, n: number, guarantee?: boolean) => {
    const r = await need().bestOf(goal, n, { guarantee });
    pushUsage();
    return { report: r.report, applied: r.applied, branch: r.branch ?? null, winner: r.winner ?? null };
  });

  ipcMain.handle("abort", () => {
    engine?.abort();
    // Anything waiting on the user is answered "no" so the run can unwind.
    for (const [id, resolve] of pending) {
      resolve({ allow: false });
      pending.delete(id);
    }
  });

  ipcMain.handle("answer", (_e, id: string, answer: RequestAnswer) => {
    pending.get(id)?.(answer);
    pending.delete(id);
  });

  ipcMain.handle("newConversation", () => need().newConversation());
  ipcMain.handle("undo", () => need().undo());
  ipcMain.handle("skills", () => (engine ? engine.skills.map((s) => ({ name: s.name, description: s.description })) : []));
  ipcMain.handle("sessions", () =>
    engine ? engine.sessions().map((s) => ({ id: s.id, title: s.title, updated: s.updated })) : [],
  );
  ipcMain.handle("resume", async (_e, id: string) => {
    const e = need();
    if (!(await e.resume(id))) throw new Error("Session not found.");
    pushUsage();
    return e.transcript();
  });
  ipcMain.handle("workingDiff", () => (engine ? engine.workingDiff() : ""));

  ipcMain.handle("getSettings", (): Settings => {
    const cfg = loadConfig(engine?.root ?? os.homedir());
    return {
      models: cfg.models,
      effort: cfg.effort,
      maxParallel: cfg.maxParallel,
      verifyCommand: cfg.verifyCommand ?? "",
      permission: cfg.permission,
      budgetUsd: cfg.budgetUsd ?? null,
    };
  });

  ipcMain.handle("saveSettings", async (_e, s: Settings) => {
    const current = readJson<Record<string, unknown>>(GLOBAL_CONFIG, {});
    writeJson(GLOBAL_CONFIG, {
      ...current,
      models: s.models,
      effort: s.effort,
      maxParallel: Math.max(1, Math.min(32, Math.round(s.maxParallel))),
      verifyCommand: s.verifyCommand || undefined,
      permission: s.permission,
      budgetUsd: s.budgetUsd && s.budgetUsd > 0 ? s.budgetUsd : undefined,
    });
    return engine && !engine.busy ? openEngine(engine.root) : null;
  });

  ipcMain.handle("setKey", async (_e, provider: string, key: string) => {
    const env = BUILTIN_PROVIDERS[provider]?.apiKeyEnv;
    if (!env) throw new Error(`Unknown provider ${provider}`);
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure storage is not available on this system; set the key as an environment variable instead.");
    const raw = readJson<Record<string, string>>(CREDENTIALS, {});
    if (key.trim()) {
      raw[env] = safeStorage.encryptString(key.trim()).toString("base64");
    } else {
      delete raw[env];
      if (appKeys.has(env)) {
        delete process.env[env];
        appKeys.delete(env);
      }
    }
    writeJson(CREDENTIALS, raw);
    applyStoredKeys();
    clearModelCache();
    if (engine && !engine.busy) await openEngine(engine.root);
    return appState();
  });

  ipcMain.handle("signIn", async (_e, provider: "github" | "google") => {
    const cfg = oauthConfig();
    signInAbort?.abort();
    signInAbort = new AbortController();
    const signal = signInAbort.signal;
    if (provider === "github") {
      if (!cfg.githubClientId) throw new Error("GitHub sign-in is not configured for this build (set SWARMCODE_GITHUB_CLIENT_ID).");
      const code = await githubStart(cfg.githubClientId);
      push({ type: "device-code", code: code.userCode, url: code.verificationUri });
      void shell.openExternal(code.verificationUri);
      const { account, token } = await githubFinish(cfg.githubClientId, code, signal);
      saveAccount(account, token);
    } else {
      if (!cfg.googleClientId) throw new Error("Google sign-in is not configured for this build (set SWARMCODE_GOOGLE_CLIENT_ID).");
      const { account } = await googleSignIn(cfg.googleClientId, cfg.googleClientSecret, (url) => void shell.openExternal(url), signal);
      saveAccount(account);
    }
    return appState();
  });
  ipcMain.handle("cancelSignIn", () => signInAbort?.abort());
  ipcMain.handle("signOut", () => {
    saveAccount(null);
    return appState();
  });

  ipcMain.handle("openExternal", (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url);
  });
}

// ---- window --------------------------------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "SwarmCode",
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    // The UI draws its own title bar; the OS keeps native window controls.
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 16, y: 15 } }
      : { titleBarOverlay: { color: "#0a0a0a", symbolColor: "#8a8a8a", height: 44 } }),
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  // The UI is local; never navigate away or open windows inside the app.
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  void win.loadFile(path.join(here, "renderer", "index.html"));
  win.on("closed", () => (win = null));

  if (process.env.SWARMCODE_SMOKE_TEST) {
    // CI smoke test: prove the window and bridge load, then quit.
    win.webContents.once("did-finish-load", async () => {
      process.on("unhandledRejection", (err) => {
        console.log(`SMOKE FAIL ${(err as Error)?.message ?? err}`);
        app.exit(1);
      });
      let ok = await win!.webContents.executeJavaScript("typeof window.swarm === 'object' && document.querySelector('#app') !== null");
      console.log(`SMOKE startup ${Math.round(performance.now())}ms`);
      const project = process.env.SWARMCODE_SMOKE_PROJECT;
      if (ok && project) {
        // Exercise the bundled engine end to end: config, git, repo map, sessions.
        const info = await win!.webContents.executeJavaScript(
          `window.swarm.openProject(${JSON.stringify(project)}).then(async (p) => ({ p, sessions: await window.swarm.sessions(), diff: await window.swarm.workingDiff() }))`,
        );
        console.log(`SMOKE project ${info.p.name} repo=${info.p.isRepo} models=${info.p.models.main} diffBytes=${info.diff.length}`);
        ok = info.p.isRepo === true;
      }
      if (ok && project) {
        // Document tools must work in the packaged app (PDF.js worker, mammoth, browser).
        const { generatePdf, readDocument } = await import("../../src/tools/documents.js");
        const ctx = { root: project, approve: async () => true };
        await generatePdf.run({ output: "smoke.pdf", content: "# Smoke test\n\nHello from SwarmCode." }, ctx);
        const text = await readDocument.run({ path: "smoke.pdf" }, ctx);
        console.log(`SMOKE docs ${/Hello from SwarmCode/.test(text) ? "ok" : "FAIL"}`);
        ok = /Hello from SwarmCode/.test(text);
        const docx = process.env.SWARMCODE_SMOKE_DOCX;
        if (ok && docx) {
          const words = await readDocument.run({ path: docx }, ctx);
          console.log(`SMOKE docx ${words.trim().length > 0 && !/^Error/i.test(words) ? "ok" : "FAIL " + words.slice(0, 120)}`);
          ok = words.trim().length > 0 && !/^Error/i.test(words);
        }
      }
      const mem = await app.getAppMetrics();
      console.log(`SMOKE memory ${Math.round(mem.reduce((a, m) => a + m.memory.workingSetSize, 0) / 1024)}MB across ${mem.length} processes`);
      console.log(`SMOKE ${ok ? "OK" : "FAIL"}`);
      app.exit(ok ? 0 : 1);
    });
  }
}

app.whenReady().then(() => {
  applyStoredKeys();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  await engine?.close();
  if (process.platform !== "darwin") app.quit();
});
