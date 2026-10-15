import type {
  AgentEvent,
  HealthReportView,
  AppState,
  Plan,
  ProjectInfo,
  Push,
  Role,
  SessionSummary,
  Settings,
  SwarmApi,
  TaskState,
  UsageInfo,
  UserRequest,
} from "../shared.js";
import { parseDiff, renderDiffFile } from "./diff.js";
import { icon, svg, toolIcon } from "./icons.js";
import { renderMarkdown } from "./markdown.js";

declare global {
  interface Window {
    swarm: SwarmApi;
  }
}

const api = window.swarm;
const root = document.getElementById("app")!;

// ---- tiny DOM helper -------------------------------------------------------------

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k === "text") el.textContent = String(v);
    else if (k === "html") el.innerHTML = String(v); // only ever given escaped or constant markup
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v as EventListener);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

function toast(message: string, error = false) {
  document.querySelector(".toast")?.remove();
  const t = h("div", { class: `toast${error ? " err" : ""}` }, icon(error ? "alert" : "check"), message);
  document.body.append(t);
  setTimeout(() => t.remove(), error ? 6000 : 2400);
}

const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const mod = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl";

// ---- state ---------------------------------------------------------------------------

let appState: AppState;
let project: ProjectInfo | null = null;
let busy = false;
type Mode = "agent" | "swarm" | "best" | "plan" | "review";
/** Images pasted or dropped into the composer, sent with the next request. */
let attachments: Array<{ mediaType: string; data: string; name: string }> = [];
/** The live checklist the agent keeps for the current request. */
let todoEl: HTMLElement | null = null;
/** Options picked with / commands for the next message. No mode means SwarmCode decides. */
let picked: { mode?: Mode; guarantee: boolean; skills: string[] } = { guarantee: false, skills: [] };
let chipsEl: HTMLElement;
let paletteEl: HTMLElement;
let health: HealthReportView | null = null;
let healthBusy = false;
let tasks: TaskState[] = [];
let plan: Plan | null = null;
const feeds = new Map<string, { lines: Array<{ text: string; err?: boolean }>; at: number }>();
let panelTab: "agents" | "changes" | "health" = "agents";
let panelOpen = true;
let diffText = "";
let diffSource: "working" | "result" = "working";
let usage: UsageInfo | null = null;
let sessions: SessionSummary[] = [];
let activeSession: string | null = null;
let skills: Array<{ name: string; description: string }> = [];

// Elements that live across renders.
let transcriptEl: HTMLElement;
let colEl: HTMLElement;
let panelBodyEl: HTMLElement;
let panelHeadEl: HTMLElement;
let meterEl: HTMLElement;
let sendBtn: HTMLButtonElement;
let inputEl: HTMLTextAreaElement;
let sideSessionsEl: HTMLElement;
let thinkingEl: HTMLElement | null = null;
let stepsEl: HTMLElement | null = null;
let streaming: { body: HTMLElement; text: string; raf: number } | null = null;

// ---- boot ----------------------------------------------------------------------------

async function boot() {
  appState = await api.state();
  document.body.classList.add(`os-${appState.platform}`);
  api.onPush(onPush);
  document.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest("a[data-external]") as HTMLAnchorElement | null;
    if (a) {
      e.preventDefault();
      void api.openExternal(a.href);
    }
  });
  document.addEventListener("keydown", onShortcut);
  renderWelcome();
}

function onShortcut(e: KeyboardEvent) {
  if (e.key === "Escape") {
    document.querySelector(".overlay")?.remove();
    return;
  }
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === "o") {
    e.preventDefault();
    void openProject();
  } else if (k === ",") {
    e.preventDefault();
    void openSettings();
  } else if (project && k === "n") {
    e.preventDefault();
    void newChat();
  } else if (project && k === "b") {
    e.preventDefault();
    togglePanel();
  } else if (project && k === "z" && e.shiftKey) {
    e.preventDefault();
    void undoLast();
  }
}

const hasAnyKey = () => appState.providers.some((p) => p.source === "env" || p.source === "app");

function titlebar(...children: Child[]) {
  return h("header", { class: "titlebar" }, h("div", { class: "brand" }, h("div", { class: "mark", html: svg("mark") }), "SwarmCode"), ...children);
}

// ---- welcome ---------------------------------------------------------------------------

function renderWelcome() {
  const recent = appState.recent;
  const acct = appState.account;
  root.replaceChildren(
    h(
      "div",
      { class: "welcome" },
      titlebar(h("div", { class: "spacer" }), h("button", { class: "icon-btn", title: `Settings (${mod}+,)`, onclick: () => openSettings(), html: svg("settings") })),
      h(
        "div",
        { class: "welcome-scroll" },
        h(
          "div",
          { class: "welcome-inner" },
          h(
            "div",
            { class: "hero" },
            h("div", { class: "mark", html: svg("mark") }),
            h("h1", { text: acct ? `Welcome back, ${acct.name.split(" ")[0]}.` : "Your AI engineering team." }),
            h("p", { text: "Describe what you want. SwarmCode plans it, builds it with agents working in parallel, tests and reviews the result, and shows you a clean diff. Apps, APIs, data, documents, security: one workspace." }),
            h(
              "div",
              { class: "welcome-actions" },
              h("button", { class: "btn primary", onclick: () => openProject() }, icon("folder"), "Open project", h("span", { class: "kbd", text: `${mod} O` })),
              h("button", { class: "btn", onclick: () => openSettings() }, icon("settings"), "Settings"),
            ),
            !hasAnyKey() &&
              h(
                "div",
                { class: "notice" },
                icon("key"),
                h("span", { class: "grow", text: "Connect a model to start: add an API key (Anthropic, OpenAI, Gemini, OpenRouter...) or use local and cloud models through Ollama." }),
                h("button", { class: "btn sm", onclick: () => openSettings(), text: "Connect" }),
              ),
          ),
          acct ? accountCard(acct) : signInCard(),
          recent.length
            ? h(
                "div",
                {},
                h("div", { class: "section-label" }, "Recent projects"),
                h(
                  "div",
                  { class: "recent" },
                  ...recent.map((p) => h("button", { onclick: () => openProject(p) }, icon("folder"), h("b", { text: p.split(/[\\/]/).pop() ?? p }), h("small", { text: p }))),
                ),
              )
            : null,
          h(
            "div",
            { class: "features" },
            feature("agents", "A team, not a chatbot", "Big jobs are split into tasks that parallel agents build at the same time, then merged."),
            feature("check", "Checked before you see it", "Tests, an independent review and a security check run on every change."),
            feature("sparkle", "Skills for every job", "Web and mobile apps, APIs, databases, documents and PDFs, data, DevOps and security."),
          ),
          h("div", { class: "foot", text: `v${appState.version}` }),
        ),
      ),
    ),
  );
}

function signInCard() {
  const btn = (provider: "github" | "google", label: string) =>
    h("button", { class: "btn signin", onclick: () => signIn(provider) }, h("span", { class: "icon", html: provider === "github" ? GITHUB_SVG : GOOGLE_SVG }), label);
  return h(
    "div",
    { class: "signin-card" },
    h("div", { class: "grow" }, h("b", { text: "Sign in" }), h("span", { text: "Keep your profile and preferences, and connect GitHub for pull requests." })),
    btn("github", "GitHub"),
    btn("google", "Google"),
  );
}

function accountCard(a: NonNullable<AppState["account"]>) {
  return h(
    "div",
    { class: "signin-card" },
    avatarEl(a),
    h("div", { class: "grow" }, h("b", { text: a.name }), h("span", { text: `Signed in with ${a.provider === "github" ? `GitHub${a.login ? ` as @${a.login}` : ""}` : `Google${a.email ? ` as ${a.email}` : ""}`}` })),
    h("button", { class: "btn ghost sm", onclick: signOut, text: "Sign out" }),
  );
}

function avatarEl(a: NonNullable<AppState["account"]>, cls = "avatar") {
  if (a.avatar) return h("img", { class: cls, src: a.avatar, alt: "" });
  return h("span", { class: `${cls} initials`, text: a.name.slice(0, 1).toUpperCase() });
}

let deviceDialog: HTMLElement | null = null;

async function signIn(provider: "github" | "google") {
  if (provider === "github" ? !appState.signIn.github : !appState.signIn.google) {
    return toast(`${provider === "github" ? "GitHub" : "Google"} sign-in isn't set up in this build yet. See "Sign-in setup" in the README.`, true);
  }
  if (provider === "google") toast("Continue in your browser…");
  try {
    appState = await api.signIn(provider);
    toast(`Signed in as ${appState.account?.name ?? "you"}`);
  } catch (e) {
    const msg = errText(e);
    if (!/cancelled/i.test(msg)) toast(msg, true);
  } finally {
    deviceDialog?.remove();
    deviceDialog = null;
  }
  project ? renderWorkspace() : renderWelcome();
}

function showDeviceCode(code: string, url: string) {
  deviceDialog?.remove();
  const copy = () => void navigator.clipboard?.writeText(code).then(() => toast("Code copied"));
  deviceDialog = h(
    "div",
    { class: "overlay" },
    h(
      "div",
      { class: "modal narrow" },
      h("div", { class: "modal-head" }, h("h2", { text: "Sign in with GitHub" }), h("button", { class: "icon-btn", title: "Cancel", onclick: () => void api.cancelSignIn(), html: svg("x") })),
      h(
        "div",
        { class: "modal-body center" },
        h("p", { class: "hint", text: "We opened GitHub in your browser. Enter this code there to approve SwarmCode:" }),
        h("div", { class: "device-code", text: code }),
        h("div", { class: "row-center" }, h("button", { class: "btn", onclick: copy }, icon("check"), "Copy code"), h("button", { class: "btn ghost", onclick: () => void api.openExternal(url), text: "Open GitHub again" })),
        h("div", { class: "thinking" }, h("span", { class: "shimmer", text: "Waiting for approval" })),
      ),
    ),
  );
  document.body.append(deviceDialog);
}

async function signOut() {
  appState = await api.signOut();
  toast("Signed out");
  project ? renderWorkspace() : renderWelcome();
}

const GITHUB_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49l-.01-1.7c-2.78.62-3.37-1.21-3.37-1.21-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.85.09-.66.35-1.12.64-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.36 9.36 0 0 1 12 6.98c.85 0 1.71.12 2.51.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.94.68 1.9l-.01 2.81c0 .27.18.6.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/></svg>';
const GOOGLE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3.01h3.88c2.27-2.09 3.57-5.17 3.57-8.83z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3.01c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.11A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28V6.61H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.39l4-3.11z"/><path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.61l4 3.11C6.22 6.88 8.87 4.77 12 4.77z"/></svg>';

function feature(ic: string, title: string, text: string) {
  return h("div", { class: "feature" }, icon(ic), h("b", { text: title }), h("span", { text }));
}

async function openProject(path?: string) {
  if (busy) return toast("Stop the running agent before switching projects.", true);
  try {
    const info = await api.openProject(path);
    if (!info) return;
    project = info;
    tasks = [];
    plan = null;
    feeds.clear();
    diffText = "";
    diffSource = "working";
    activeSession = null;
    skills = await api.skills().catch(() => []);
    renderWorkspace();
    for (const w of info.warnings) addStatus(w, "warn");
    if (!info.isRepo) addStatus("Not a git repository: parallel agents are off. Run `git init` and commit to enable them.", "warn");
    void refreshSessions();
    void refreshWorkingDiff();
  } catch (e) {
    toast(errText(e), true);
  }
}

// ---- workspace -----------------------------------------------------------------------

function renderWorkspace() {
  if (!project) return renderWelcome();
  meterEl = h("div", { class: "meter no-drag" });
  const top = titlebar(
    h("span", { class: "crumb-sep", text: "/" }),
    h("div", { class: "crumb", title: project.root }, project.name, project.isRepo ? h("span", { class: "chip" }, icon("branch", "icon"), "git") : null),
    h("div", { class: "spacer" }),
    meterEl,
    h("button", { class: `icon-btn${panelOpen ? " on" : ""}`, title: `Toggle panel (${mod}+B)`, onclick: togglePanel, html: svg("panel") }),
    h("button", { class: "icon-btn", title: `Settings (${mod}+,)`, onclick: () => openSettings(), html: svg("settings") }),
  );

  sideSessionsEl = h("div", { class: "side-list" });
  const side = h(
    "aside",
    { class: "sidebar" },
    h("div", { class: "side-top" }, h("button", { class: "btn new-chat", onclick: newChat }, icon("plus"), "New chat", h("span", { class: "kbd", text: `${mod} N` }))),
    h("div", { class: "side-label" }, "Conversations"),
    sideSessionsEl,
    h(
      "div",
      { class: "side-foot" },
      h("button", { class: "side-row", onclick: () => openProject(), title: `Open another folder (${mod}+O)` }, icon("folder"), h("span", { class: "grow", text: project.name }), icon("chevron")),
      h("button", { class: "side-row", onclick: () => { if (!busy) { project = null; renderWelcome(); } } }, icon("layers"), h("span", { class: "grow", text: "All projects" })),
      appState.account
        ? h("button", { class: "side-row account", title: "Account", onclick: () => openSettings() }, avatarEl(appState.account, "avatar sm"), h("span", { class: "grow", text: appState.account.name }), icon("settings"))
        : h("button", { class: "side-row", onclick: () => { project = null; renderWelcome(); } }, icon("key"), h("span", { class: "grow", text: "Sign in" })),
    ),
  );

  colEl = h("div", { class: "col" });
  transcriptEl = h("div", { class: "transcript" }, colEl);
  inputEl = h("textarea", {
    rows: 1,
    placeholder: "Ask anything or describe what to build.  Type / for commands",
    oninput: () => {
      autosize();
      updatePalette();
    },
    onkeydown: onComposerKey,
    onblur: () => setTimeout(hidePalette, 120),
    onpaste: (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        void addImages(files);
      }
    },
  }) as HTMLTextAreaElement;
  sendBtn = h("button", { class: "send", title: "Send (Enter)", onclick: () => (busy ? stop() : submit()) }) as HTMLButtonElement;
  chipsEl = h("div", { class: "chips" });
  paletteEl = h("div", { class: "palette", hidden: true });
  const composer = h(
    "div",
    {
      class: "composer",
      ondragover: (e: DragEvent) => {
        if ([...(e.dataTransfer?.items ?? [])].some((i) => i.type.startsWith("image/"))) e.preventDefault();
      },
      ondrop: (e: DragEvent) => {
        const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (files.length) {
          e.preventDefault();
          void addImages(files);
        }
      },
    },
    h(
      "div",
      { class: "col" },
      h(
        "div",
        { class: "composer-box" },
        paletteEl,
        chipsEl,
        inputEl,
        h(
          "div",
          { class: "composer-row" },
          h("button", { class: "slash-hint", title: "Modes, skills and options", onclick: () => openPaletteFromButton() }, h("span", { class: "kbd", text: "/" }), "Commands"),
          h("div", { class: "spacer" }),
          h("button", { class: "icon-btn", title: `Undo the last request's file changes (${mod}+Shift+Z)`, onclick: undoLast, html: svg("undo") }),
          sendBtn,
        ),
      ),
      h("div", { class: "composer-hint", text: "SwarmCode picks the right skills and asks before using several agents · Shift+Enter for a new line" }),
    ),
  );
  renderChips();
  const main = h("main", { class: "main" }, transcriptEl, composer);

  panelHeadEl = h("div", { class: "panel-head" });
  panelBodyEl = h("div", { class: "panel-body" });
  const panel = h("section", { class: "panel" }, panelHeadEl, panelBodyEl);

  root.replaceChildren(h("div", { class: `shell${panelOpen ? "" : " no-panel"}` }, top, side, main, panel));
  renderPanel();
  renderMeter();
  renderSessions();
  setBusy(false);
  if (!colEl.childElementCount) renderEmptyState();
  inputEl.focus();
}

function renderEmptyState() {
  const suggest = (ic: string, title: string, text: string, prompt: string, skill = "") =>
    h(
      "button",
      {
        class: "suggestion",
        onclick: () => {
          inputEl.value = prompt;
          if (skill && skills.some((s) => s.name === skill) && !picked.skills.includes(skill)) {
            picked.skills.push(skill);
            renderChips();
          }
          autosize();
          inputEl.focus();
        },
      },
      icon(ic),
      h("div", {}, h("b", { text: title }), h("span", { text })),
    );
  colEl.append(
    h(
      "div",
      { class: "empty-state" },
      h(
        "div",
        {},
        h("div", { class: "mark", html: svg("mark") }),
        h("h2", { text: `What are we working on in ${project!.name}?` }),
        h("p", { text: `${project!.models.main.split("/").pop()} plans · ${project!.models.worker.split("/").pop()} builds · up to ${project!.maxParallel} agents in parallel` }),
        h(
          "div",
          { class: "suggestions" },
          suggest("agents", "Build a feature", "Describe it; agents plan and build it", "Add "),
          suggest("bug", "Fix a bug", "Find the root cause, fix it, prove it", "Find and fix the bug where ", "debugging"),
          suggest("book", "Explain this project", "Architecture, data flow, where things live", "Explain how this project works: main modules, data flow and entry points.", "explain-codebase"),
          suggest("file", "Work with documents", "Read PDFs and Word files, create PDFs", "Read the document at ", "documents"),
          suggest("globe", "Test the app in a browser", "Run it and click through the flows", "Start the app and test the main user flows in the browser. Report or fix what breaks.", "web-qa"),
          suggest("shield", "Security check", "Find vulnerabilities with fixes", "Do a security review of this codebase. Report findings by severity with concrete fixes.", "security-review"),
        ),
      ),
    ),
  );
}

function togglePanel() {
  panelOpen = !panelOpen;
  document.querySelector(".shell")?.classList.toggle("no-panel", !panelOpen);
}

function autosize() {
  inputEl.style.height = "auto";
  inputEl.style.height = `${Math.min(260, inputEl.scrollHeight)}px`;
}

function setBusy(b: boolean) {
  busy = b;
  sendBtn.innerHTML = svg(b ? "stop" : "arrowUp");
  sendBtn.classList.toggle("stop", b);
  sendBtn.title = b ? "Stop" : "Send (Enter)";
  if (!b) hideThinking();
}

// ---- conversation -----------------------------------------------------------------------

function scrollDown(force = false) {
  const near = transcriptEl.scrollHeight - transcriptEl.scrollTop - transcriptEl.clientHeight < 220;
  if (force || near) transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function append(el: HTMLElement) {
  colEl.querySelector(".empty-state")?.remove();
  if (!el.classList.contains("steps")) stepsEl = null;
  if (thinkingEl?.parentElement === colEl) colEl.insertBefore(el, thinkingEl);
  else colEl.append(el);
  if (el.classList.contains("attention")) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  else scrollDown();
  return el;
}

function addUser(text: string) {
  append(h("div", { class: "msg user" }, h("div", { class: "bubble", text })));
  scrollDown(true);
}

function addAssistant(text: string) {
  append(h("div", { class: "msg assistant" }, h("div", { class: "body", html: renderMarkdown(text) })));
}

function addStatus(text: string, tone?: "good" | "bad" | "warn") {
  const t = tone ?? (/passed|applied|approved|Undid/i.test(text) ? "good" : /fail|error|declined|could not/i.test(text) ? "bad" : /conflict|untracked|not a git/i.test(text) ? "warn" : undefined);
  append(h("div", { class: `status-line${t ? ` ${t}` : ""}` }, h("span", { class: "dot" }), h("span", { text })));
}

const MAX_VISIBLE_STEPS = 6;

/** Tool calls go into one quiet timeline per burst; long bursts fold their oldest steps. */
function addStep(tool: string, arg: string, kind: "" | "err" | "ok" = "") {
  if (!stepsEl || !stepsEl.isConnected) {
    // Continue the previous timeline if nothing else was added after it (e.g. an approval card came and went).
    const last = [...colEl.children].filter((el) => el !== thinkingEl).pop();
    stepsEl = last?.classList.contains("steps") ? (last as HTMLElement) : append(h("div", { class: "steps" }));
  }
  const row = h("div", { class: `step${kind ? ` ${kind}` : ""}` }, icon(kind === "err" ? "x" : kind === "ok" ? "check" : toolIcon(tool)), h("b", { text: tool }), h("span", { class: "arg", text: arg }));
  stepsEl.append(row);
  const rows = [...stepsEl.querySelectorAll<HTMLElement>(".step")];
  if (rows.length > MAX_VISIBLE_STEPS) {
    const hidden = rows.slice(0, rows.length - MAX_VISIBLE_STEPS);
    hidden.forEach((r) => (r.hidden = true));
    let more = stepsEl.querySelector<HTMLButtonElement>(".steps-more");
    if (!more) {
      const group = stepsEl;
      more = h("button", {
        class: "steps-more",
        onclick: () => {
          group.querySelectorAll<HTMLElement>(".step").forEach((r) => (r.hidden = false));
          group.querySelector(".steps-more")?.remove();
        },
      }) as HTMLButtonElement;
      stepsEl.prepend(more);
    }
    more.textContent = `Show ${hidden.length} earlier step${hidden.length > 1 ? "s" : ""}`;
  }
  scrollDown();
}

function showThinking() {
  if (thinkingEl || streaming) return;
  thinkingEl = h("div", { class: "thinking" }, h("span", { class: "shimmer", text: "Thinking" }));
  colEl.append(thinkingEl);
  scrollDown();
}

function hideThinking() {
  thinkingEl?.remove();
  thinkingEl = null;
}

function streamText(delta: string) {
  hideThinking();
  if (!streaming) {
    const body = h("div", { class: "body" });
    append(h("div", { class: "msg assistant" }, body));
    streaming = { body, text: "", raf: 0 };
  }
  streaming.text += delta;
  if (!streaming.raf) {
    const s = streaming;
    s.raf = requestAnimationFrame(() => {
      s.raf = 0;
      s.body.innerHTML = renderMarkdown(s.text);
      scrollDown();
    });
  }
}

function endStream() {
  if (!streaming) return;
  cancelAnimationFrame(streaming.raf);
  streaming.body.innerHTML = renderMarkdown(streaming.text);
  streaming = null;
}

async function submit() {
  const typed = inputEl.value.trim();
  const { mode, guarantee, skills: chosen } = picked;
  // Review needs no text: it reviews the working tree (text is an optional focus).
  if ((!typed && mode !== "review") || busy || !project) return;
  const images = attachments.map(({ mediaType, data }) => ({ mediaType, data }));
  const text = typed || "Review my uncommitted changes";
  picked = { guarantee: false, skills: [] };
  attachments = [];
  todoEl = null;
  renderChips();
  hidePalette();
  inputEl.value = "";
  autosize();
  addUser(images.length ? `${text}\n\n(${images.length} image${images.length > 1 ? "s" : ""} attached)` : text);
  setBusy(true);
  try {
    if (mode === "review") {
      showThinking();
      const r = await api.review(typed || undefined);
      hideThinking();
      append(
        card(
          r.approved ? "shieldCheck" : "alert",
          r.approved ? "No material problems found" : "Review found issues",
          r.scope,
          h("div", { class: "md", html: renderMarkdown(r.feedback.replace(/^\**LGTM\**\s*/i, "")) }),
        ),
      );
    } else if (mode === "plan") {
      showThinking();
      await api.send(text, chosen.length ? chosen : undefined, guarantee, { plan: true, images });
      endStream();
      const c = card("list", "Plan ready", "Nothing has changed yet. Review the plan above, then implement it or refine it.");
      c.classList.add("attention");
      c.append(
        h(
          "div",
          { class: "card-actions" },
          h("button", { class: "btn ghost", onclick: () => (c.remove(), inputEl.focus()), text: "Refine first" }),
          h(
            "button",
            {
              class: "btn primary",
              onclick: () => {
                c.remove();
                inputEl.value = "Implement the plan above. Follow it, adjust if you find something it missed, and verify the result.";
                picked.mode = "agent";
                void submit();
              },
            },
            icon("check"),
            "Implement this plan",
          ),
        ),
      );
      append(c);
    } else if (mode === "best" || mode === "swarm") {
      tasks = [];
      plan = null;
      feeds.clear();
      showPanel("agents");
      showThinking();
      const r = mode === "best" ? await api.bestOf(text, 3, guarantee) : await api.swarm(text, guarantee);
      if (!r.applied && r.branch) addStatus(`Result kept on branch ${r.branch}.`);
    } else if (mode === "agent" || images.length) {
      // Images go to the single agent (autopilot's parallel modes don't take them).
      showThinking();
      await api.send(text, chosen.length ? chosen : undefined, guarantee, { images });
      endStream();
    } else {
      // No mode picked: SwarmCode decides, and asks before using several agents.
      tasks = [];
      plan = null;
      feeds.clear();
      showThinking();
      await api.auto(text, guarantee, chosen.length ? chosen : undefined);
      endStream();
    }
  } catch (e) {
    endStream();
    const msg = errText(e);
    if (msg !== "Aborted") append(card("alert", "Something went wrong", null, h("pre", { text: msg })));
  } finally {
    setBusy(false);
    void refreshSessions();
    if (diffSource === "working") void refreshWorkingDiff();
  }
}

async function stop() {
  await api.abort();
  endStream();
  addStatus("Stopped.");
}

async function newChat() {
  if (busy) return toast("Stop the running agent first.", true);
  await api.newConversation();
  activeSession = null;
  colEl.replaceChildren();
  stepsEl = null;
  renderEmptyState();
  renderSessions();
  inputEl.focus();
}

async function undoLast() {
  if (busy) return toast("Stop the running agent first.", true);
  try {
    const files = await api.undo();
    if (!files.length) return toast("Nothing to undo.");
    addStatus(`Undid the last changes: ${files.join(", ")}`);
    void refreshWorkingDiff();
  } catch (e) {
    toast(errText(e), true);
  }
}

// ---- composer: chips and the / command palette ------------------------------------------

interface Command {
  id: string;
  kind: "mode" | "flag" | "skill";
  label: string;
  hint: string;
  icon: string;
}

function commands(): Command[] {
  const repo = Boolean(project?.isRepo);
  const out: Command[] = [
    { id: "agent", kind: "mode", label: "agent", hint: "Use a single agent for this request", icon: "sparkle" },
    { id: "plan", kind: "mode", label: "plan", hint: "Investigate read-only and propose a plan; nothing changes until you approve", icon: "list" },
    ...(repo
      ? [
          { id: "swarm", kind: "mode", label: "swarm", hint: "Plan it and build it with parallel agents", icon: "agents" } as Command,
          { id: "best", kind: "mode", label: "best", hint: "Three independent attempts; the best verified one wins", icon: "layers" } as Command,
          { id: "review", kind: "mode", label: "review", hint: "Review your uncommitted changes for real problems (text = what to focus on)", icon: "search" } as Command,
        ]
      : []),
    { id: "guarantee", kind: "flag", label: "guarantee", hint: "Hidden acceptance tests decide when the work is done", icon: "shieldCheck" },
  ];
  for (const s of skills) out.push({ id: s.name, kind: "skill", label: s.name, hint: s.description, icon: skillIcon(s.name) });
  return out;
}

function skillIcon(name: string) {
  if (/security|threat|secret|harden|pentest|compliance|suspicious|forensic|detection|cloud-security|api-security/.test(name)) return "shield";
  if (/debug|test/.test(name)) return "bug";
  if (/doc|explain|pdf/.test(name)) return "book";
  if (/ui|frontend|design|web-qa/.test(name)) return "globe";
  return "sparkle";
}

let paletteItems: Command[] = [];
let paletteIndex = 0;

function slashQuery(): { query: string; start: number } | null {
  const before = inputEl.value.slice(0, inputEl.selectionStart ?? inputEl.value.length);
  const m = /(^|\s)\/([\w-]*)$/.exec(before);
  return m ? { query: m[2].toLowerCase(), start: before.length - m[2].length - 1 } : null;
}

function updatePalette() {
  const found = slashQuery();
  if (!found) return hidePalette();
  const q = found.query;
  const all = commands().filter((c) => !(c.kind === "skill" && picked.skills.includes(c.id)) && !(c.kind === "flag" && picked.guarantee) && !(c.kind === "mode" && picked.mode === c.id));
  paletteItems = all
    .map((c) => ({ c, rank: c.label.startsWith(q) ? 0 : c.label.includes(q) ? 1 : c.hint.toLowerCase().includes(q) ? 2 : 9 }))
    .filter((x) => x.rank < 9)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 9)
    .map((x) => x.c);
  if (!paletteItems.length) return hidePalette();
  paletteIndex = Math.min(paletteIndex, paletteItems.length - 1);
  const group = (k: Command["kind"]) => (k === "mode" ? "Mode" : k === "flag" ? "Option" : "Skill");
  paletteEl.replaceChildren(
    ...paletteItems.map((c, i) =>
      h(
        "button",
        { class: `palette-item${i === paletteIndex ? " on" : ""}`, onmousedown: (e: Event) => (e.preventDefault(), choose(c)) },
        icon(c.icon),
        h("b", { text: `/${c.label}` }),
        h("span", { class: "phint", text: c.hint }),
        h("span", { class: "pkind", text: group(c.kind) }),
      ),
    ),
  );
  paletteEl.hidden = false;
}

function hidePalette() {
  if (paletteEl) paletteEl.hidden = true;
  paletteIndex = 0;
}

function openPaletteFromButton() {
  const v = inputEl.value;
  if (!/(^|\s)\/[\w-]*$/.test(v)) inputEl.value = v + (v && !v.endsWith(" ") ? " /" : "/");
  inputEl.focus();
  inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
  updatePalette();
}

function choose(c: Command) {
  const q = slashQuery();
  if (q) {
    const end = inputEl.selectionStart ?? inputEl.value.length;
    inputEl.value = (inputEl.value.slice(0, q.start) + inputEl.value.slice(end)).replace(/\s{2,}/g, " ");
  }
  if (c.kind === "mode") picked.mode = c.id as Mode;
  else if (c.kind === "flag") picked.guarantee = true;
  else picked.skills.push(c.id);
  hidePalette();
  renderChips();
  autosize();
  inputEl.focus();
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** Attach pasted or dropped images (up to 5, 5 MB each) to the next request. */
async function addImages(files: File[]) {
  for (const f of files) {
    if (attachments.length >= 5) return toast("Up to 5 images per request.", true);
    if (!IMAGE_TYPES.includes(f.type)) {
      toast(`${f.name || "That image"} isn't PNG, JPEG, GIF or WebP.`, true);
      continue;
    }
    if (f.size > 5 * 1024 * 1024) {
      toast(`${f.name || "That image"} is over 5 MB.`, true);
      continue;
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    attachments.push({ mediaType: f.type, data: btoa(bin), name: f.name || `image ${attachments.length + 1}` });
  }
  renderChips();
  inputEl.focus();
}

function renderChips() {
  if (!chipsEl) return;
  const chip = (label: string, ic: string, remove: () => void, cls = "") =>
    h("span", { class: `chip-token ${cls}` }, icon(ic), label, h("button", { class: "chip-x", title: "Remove", onclick: () => (remove(), renderChips(), inputEl.focus()), html: svg("x") }));
  const parts: HTMLElement[] = [];
  const modeIcon: Record<Mode, string> = { agent: "sparkle", swarm: "agents", best: "layers", plan: "list", review: "search" };
  if (picked.mode) parts.push(chip(picked.mode === "best" ? "best of 3" : picked.mode, modeIcon[picked.mode], () => (picked.mode = undefined), "mode"));
  if (picked.guarantee) parts.push(chip("guarantee", "shieldCheck", () => (picked.guarantee = false), "good"));
  for (const s of picked.skills) parts.push(chip(s, skillIcon(s), () => (picked.skills = picked.skills.filter((x) => x !== s))));
  for (const a of attachments) {
    const thumb = h("img", { class: "chip-thumb", src: `data:${a.mediaType};base64,${a.data}`, alt: "" });
    parts.push(h("span", { class: "chip-token image" }, thumb, a.name, h("button", { class: "chip-x", title: "Remove", onclick: () => ((attachments = attachments.filter((x) => x !== a)), renderChips(), inputEl.focus()), html: svg("x") })));
  }
  chipsEl.replaceChildren(...parts);
  chipsEl.hidden = !parts.length;
}

function onComposerKey(e: KeyboardEvent) {
  const open = paletteEl && !paletteEl.hidden && paletteItems.length;
  if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    paletteIndex = (paletteIndex + (e.key === "ArrowDown" ? 1 : paletteItems.length - 1)) % paletteItems.length;
    updatePalette();
    return;
  }
  if (open && (e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
    e.preventDefault();
    choose(paletteItems[paletteIndex]);
    return;
  }
  if (open && e.key === "Escape") {
    e.preventDefault();
    hidePalette();
    return;
  }
  if (e.key === "Backspace" && !inputEl.value && (picked.mode || picked.guarantee || picked.skills.length)) {
    if (picked.skills.length) picked.skills.pop();
    else if (picked.guarantee) picked.guarantee = false;
    else picked.mode = undefined;
    renderChips();
    return;
  }
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void submit();
  }
}

// ---- cards --------------------------------------------------------------------------------

function card(ic: string, title: string, sub: string | null, ...body: Child[]) {
  return h(
    "div",
    { class: "card" },
    h("div", { class: "card-head" }, h("div", { class: "badge" }, icon(ic)), h("div", {}, h("h4", { text: title }), sub ? h("div", { class: "sub", text: sub }) : null)),
    body.some(Boolean) ? h("div", { class: "card-body" }, ...body) : null,
  );
}

function settle(c: HTMLElement, note: string, ok: boolean) {
  c.classList.remove("attention");
  c.classList.add("done");
  c.querySelector(".card-actions")?.remove();
  const body = c.querySelector(".card-body") ?? c.appendChild(h("div", { class: "card-body" }));
  body.append(h("div", { class: `status-line ${ok ? "good" : "bad"}` }, h("span", { class: "dot" }), h("span", { text: note })));
}

// ---- events from the engine ---------------------------------------------------------------

function onPush(p: Push) {
  if (!project) return;
  switch (p.type) {
    case "event":
      return onEvent(p.event);
    case "tasks":
      tasks = p.tasks;
      return renderPanelSoon();
    case "usage":
      usage = p.usage;
      return renderMeter();
    case "device-code":
      showDeviceCode(p.code, p.url);
      return;
    case "warning":
      return addStatus(p.message, "warn");
    case "result":
      diffText = p.diff;
      diffSource = "result";
      renderPanelSoon();
      return;
    case "request":
      return onRequest(p.request);
  }
}

function onEvent(e: AgentEvent) {
  if (e.agent === "swarm") {
    switch (e.type) {
      case "turn_start":
        return showThinking();
      case "turn_end":
        return hideThinking();
      case "text":
        return streamText(e.delta);
      case "assistant_done":
        return endStream();
      case "tool":
        endStream();
        return addStep(e.name, e.summary);
      case "tool_error":
        return addStep(e.name, e.error.split("\n")[0].slice(0, 240), "err");
      case "compacted":
        return addStatus(`Context compacted: ${Math.round(e.before / 1000)}k → ${Math.round(e.after / 1000)}k tokens`);
      case "status":
        return addStatus(e.message);
      case "todos":
        return renderTodos(e.items);
    }
    return;
  }
  if (e.type === "status") return addStatus(e.message);
  if (e.type === "tool" || e.type === "tool_error" || e.type === "compacted") {
    const f = feeds.get(e.agent) ?? { lines: [], at: 0 };
    f.lines.push(
      e.type === "tool"
        ? { text: `${e.name} ${e.summary}` }
        : e.type === "tool_error"
          ? { text: `${e.name}: ${e.error.split("\n")[0]}`, err: true }
          : { text: `compacted ${Math.round(e.before / 1000)}k → ${Math.round(e.after / 1000)}k` },
    );
    if (f.lines.length > 3) f.lines.shift();
    f.at = Date.now();
    feeds.set(e.agent, f);
    renderPanelSoon();
  }
}

/** One live checklist per request, updated in place as the agent works through it. */
function renderTodos(items: Array<{ text: string; status: "pending" | "in_progress" | "done" }>) {
  endStream();
  const done = items.filter((i) => i.status === "done").length;
  const list = h(
    "div",
    { class: "todo-list" },
    ...items.map((i) => h("div", { class: `todo ${i.status}` }, h("span", { class: "todo-mark", html: i.status === "done" ? svg("check") : "" }), h("span", { text: i.text }))),
  );
  const fresh = card("list", "Checklist", `${done} of ${items.length} done`, list);
  fresh.classList.add("todos");
  if (todoEl?.isConnected) todoEl.replaceWith(fresh);
  else append(fresh);
  todoEl = fresh;
}

function onRequest(r: UserRequest) {
  hideThinking();
  endStream();
  if (r.kind === "approve") {
    const what =
      r.approval === "bash" ? ["terminal", "Run this command?"] : r.approval === "swarm" ? ["agents", "Start parallel agents?"] : r.approval === "mcp" ? ["layers", "Call this MCP tool?"] : r.approval === "web" ? ["globe", "Fetch this page?"] : ["pencil", "Allow this change?"];
    const c = card(what[0], what[1], null, h("pre", { class: "mono", text: r.summary }));
    c.classList.add("attention");
    const decide = (allow: boolean, always = false) => {
      void api.answer(r.id, { allow, always });
      c.remove();
      addStep(allow ? (always ? "always allowed" : "allowed") : "declined", r.summary.split("\n")[0].slice(0, 160), allow ? "ok" : "err");
      if (busy) showThinking();
    };
    const alwaysLabel = r.approval === "bash" ? "Always allow commands" : r.approval === "write" ? "Always allow edits" : "Always allow";
    c.append(
      h(
        "div",
        { class: "card-actions" },
        h("button", { class: "btn ghost", onclick: () => decide(false), text: "Deny" }),
        h("button", { class: "btn", onclick: () => decide(true, true), text: alwaysLabel }),
        h("button", { class: "btn primary", onclick: () => decide(true) }, icon("check"), "Allow"),
      ),
    );
    append(c);
  } else if (r.kind === "plan") {
    plan = r.plan;
    renderPanelSoon();
    const ready = r.plan.tasks.filter((t) => !t.depends_on.length).length;
    const c = card(
      "list",
      `Plan · ${r.plan.tasks.length} task${r.plan.tasks.length > 1 ? "s" : ""}`,
      `${ready} start immediately${r.plan.verify_command ? ` · verified with ${r.plan.verify_command}` : ""}`,
      h("div", { text: r.plan.summary }),
      h(
        "div",
        { class: "plan-list" },
        ...r.plan.tasks.map((t) =>
          h(
            "div",
            { class: "plan-task" },
            h("div", {}, h("div", { class: "t", text: t.title }), h("div", { class: "id", text: t.id })),
            t.depends_on.length ? h("span", { class: "tag", text: `after ${t.depends_on.join(", ")}` }) : h("span", { class: "tag go", text: "parallel" }),
            t.files.length ? h("div", { class: "files", text: t.files.join("  ·  ") }) : null,
          ),
        ),
      ),
    );
    if (r.plan.council?.length) {
      c.querySelector(".card-body")?.append(
        h(
          "div",
          { class: "plan-list" },
          ...r.plan.council.map((v) =>
            h(
              "div",
              { class: "plan-task" },
              h("div", {}, h("div", { class: "t", text: `Council · ${v.model.split("/").pop()}` }), h("div", { class: "files", text: v.notes.split("\n").filter(Boolean).slice(0, 4).join("  ·  ") || "No concerns" })),
              h("span", { class: `tag${v.approved ? " go" : ""}`, text: v.approved ? "approved" : "concerns" }),
            ),
          ),
        ),
      );
    }
    c.classList.add("attention");
    const decide = (allow: boolean) => {
      void api.answer(r.id, { allow });
      settle(c, allow ? `Started ${r.plan.tasks.length} agent task(s)` : "Plan cancelled", allow);
      if (allow) showThinking();
    };
    c.append(
      h(
        "div",
        { class: "card-actions" },
        h("button", { class: "btn ghost", onclick: () => decide(false), text: "Cancel" }),
        h("button", { class: "btn primary", onclick: () => decide(true) }, icon("agents"), `Start ${r.plan.tasks.length} agent${r.plan.tasks.length > 1 ? "s" : ""}`),
      ),
    );
    append(c);
  } else if (r.kind === "question") {
    const c = card("help", "A quick question", null, h("div", { class: "question", text: r.question }));
    c.classList.add("attention");
    const reply = (text: string) => {
      void api.answer(r.id, { allow: true, text });
      settle(c, text ? `Answered: ${text.slice(0, 120)}` : "Skipped the question", Boolean(text));
      if (busy) showThinking();
    };
    const field = h("input", {
      class: "answer-input",
      placeholder: "Type an answer, then Enter",
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) reply((e.target as HTMLInputElement).value.trim());
      },
    }) as HTMLInputElement;
    if (r.options.length) c.append(h("div", { class: "card-actions answer-options" }, ...r.options.map((o) => h("button", { class: "btn", onclick: () => reply(o), text: o }))));
    c.append(
      h("div", { class: "card-actions" }, field, h("button", { class: "btn ghost", onclick: () => reply(""), text: "Skip" }), h("button", { class: "btn primary", onclick: () => field.value.trim() && reply(field.value.trim()) }, icon("check"), "Send")),
    );
    append(c);
    field.focus();
  } else if (r.kind === "mode") {
    const label: Record<string, [string, string]> = { agent: ["sparkle", "Single agent"], swarm: ["agents", "Parallel agents"], best: ["layers", "Best of 3"] };
    const fmtTime = (s: number) => (s >= 60 ? `~${Math.round(s / 60)} min` : `~${s}s`);
    const c = card("bolt", "This looks like a big job", `${r.size} task · ${r.reason}`, h("div", { text: r.why }));
    c.classList.add("attention");
    const decide = (m: "agent" | "swarm" | "best") => {
      void api.answer(r.id, { allow: true, mode: m });
      settle(c, `Running with ${label[m][1].toLowerCase()}`, true);
      if (m !== "agent") showPanel("agents");
      showThinking();
    };
    c.append(
      h(
        "div",
        { class: "card-actions mode-choices" },
        ...r.options.map((o) =>
          h(
            "button",
            { class: `btn${o.mode === r.recommended ? " primary" : ""}`, disabled: !o.fitsBudget, title: o.fitsBudget ? "" : "Over your budget", onclick: () => decide(o.mode) },
            icon(label[o.mode][0]),
            `${label[o.mode][1]} · ${fmtTime(o.seconds)}${o.costUsd != null ? ` · $${o.costUsd.toFixed(o.costUsd < 1 ? 2 : 1)}` : ""}`,
          ),
        ),
      ),
    );
    append(c);
  } else if (r.kind === "apply") {
    diffText = r.diff;
    diffSource = "result";
    showPanel("changes");
    const files = parseDiff(r.diff);
    const added = files.reduce((n, f) => n + f.added, 0);
    const removed = files.reduce((n, f) => n + f.removed, 0);
    const c = card("diff", "Changes ready", `${files.length} file${files.length === 1 ? "" : "s"} · +${added} −${removed}`, h("pre", { class: "mono", text: r.report }));
    c.classList.add("attention");
    const decide = (allow: boolean) => {
      void api.answer(r.id, { allow });
      settle(c, allow ? "Applied to your working tree" : "Kept on its branch; your files are unchanged", allow);
    };
    c.append(
      h(
        "div",
        { class: "card-actions" },
        h("button", { class: "btn ghost", onclick: () => decide(false), text: "Keep on branch" }),
        h("button", { class: "btn", onclick: () => showPanel("changes") }, icon("diff"), "Review diff"),
        h("button", { class: "btn primary", onclick: () => decide(true) }, icon("check"), "Apply"),
      ),
    );
    append(c);
  }
}

// ---- right panel -------------------------------------------------------------------------------

function renderPanelHead() {
  const running = tasks.filter((t) => t.status === "running").length;
  const files = parseDiff(diffText).length;
  panelHeadEl.replaceChildren(
    h(
      "div",
      { class: "seg" },
      h("button", { class: panelTab === "agents" ? "on" : "", onclick: () => showPanel("agents") }, icon("agents"), "Agents", running ? h("span", { class: "count", text: String(running) }) : null),
      h("button", { class: panelTab === "changes" ? "on" : "", onclick: () => showPanel("changes") }, icon("diff"), "Changes", files ? h("span", { class: "count", text: String(files) }) : null),
      h("button", { class: panelTab === "health" ? "on" : "", onclick: () => showPanel("health") }, icon("pulse"), "Health", health ? h("span", { class: "count", text: String(health.score) }) : null),
    ),
  );
}

function showPanel(tab: "agents" | "changes" | "health") {
  panelTab = tab;
  if (!panelOpen) togglePanel();
  renderPanel();
}

let panelRaf = 0;
function renderPanelSoon() {
  if (panelRaf) return;
  panelRaf = requestAnimationFrame(() => {
    panelRaf = 0;
    renderPanel();
  });
}

setInterval(() => {
  if (project && panelTab === "agents" && tasks.some((t) => t.status === "running")) renderPanelSoon();
}, 1000);

function renderPanel() {
  if (!panelBodyEl) return;
  renderPanelHead();
  if (panelTab === "health") return renderHealth();
  if (panelTab === "agents") renderAgents();
  else renderChanges();
}

function elapsed(t: TaskState) {
  if (!t.startedAt) return "";
  const s = Math.round(((t.endedAt ?? Date.now()) - t.startedAt) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function feedEl(agent: string) {
  const f = feeds.get(agent);
  if (!f?.lines.length) return null;
  return h("div", { class: "agent-feed" }, ...f.lines.map((l) => h("div", { class: l.err ? "err" : "", text: l.text })));
}

function panelEmpty(ic: string, title: string, text: string) {
  return h("div", { class: "panel-empty" }, icon(ic), h("b", { text: title }), text);
}

function renderAgents() {
  const parts: HTMLElement[] = [];
  if (tasks.length) {
    const count = (s: string) => tasks.filter((t) => t.status === s).length;
    const stat = (n: number, l: string, cls = "") => h("div", { class: `stat ${cls}` }, h("div", { class: "n", text: String(n) }), h("div", { class: "l", text: l }));
    parts.push(
      h("div", { class: "stats" }, stat(count("done"), "done"), stat(count("running"), "running"), stat(count("pending"), "queued"), stat(count("failed") + count("skipped"), "failed", count("failed") ? "err" : "")),
    );
    for (const t of tasks) {
      parts.push(
        h(
          "div",
          { class: `agent ${t.status}` },
          h("div", { class: "agent-head" }, h("span", { class: `sdot ${t.status}` }), h("span", { class: "agent-title", text: t.task.title }), h("span", { class: "agent-id", text: t.task.id })),
          h(
            "div",
            { class: "agent-meta" },
            h("span", { text: t.status }),
            t.startedAt ? h("span", { text: elapsed(t) }) : null,
            t.model ? h("span", { text: t.model.split("/").pop()! }) : null,
            t.task.depends_on.length ? h("span", { text: `after ${t.task.depends_on.join(", ")}` }) : null,
            t.status === "done" && t.changed === false ? h("span", { text: "no changes" }) : null,
          ),
          t.status === "running" ? feedEl(t.task.id) : null,
          t.error ? h("div", { class: "agent-error", text: t.error }) : null,
        ),
      );
    }
  } else if (plan) {
    parts.push(panelEmpty("list", "Waiting for your approval", "Review the plan in the conversation."));
  }

  const taskIds = new Set(tasks.map((t) => t.task.id));
  const helpers = [...feeds.entries()].filter(([name]) => !taskIds.has(name) && name !== "swarm").sort((a, b) => b[1].at - a[1].at).slice(0, 8);
  if (helpers.length) {
    parts.push(h("div", { class: "group-label", text: "Helpers" }));
    for (const [name] of helpers) {
      const active = busy && Date.now() - feeds.get(name)!.at < 8000;
      parts.push(
        h(
          "div",
          { class: `agent${active ? " running" : ""}` },
          h("div", { class: "agent-head" }, h("span", { class: `sdot${active ? " running" : ""}` }), h("span", { class: "agent-title", text: name })),
          feedEl(name),
        ),
      );
    }
  }

  if (!parts.length) {
    parts.push(
      project?.isRepo
        ? panelEmpty("agents", "No agents running", "Use Swarm mode or give the agent a big task. Each parallel agent and helper shows up here live.")
        : panelEmpty("agents", "Parallel agents are off", "They need a git repository."),
    );
  }
  panelBodyEl.replaceChildren(...parts);
}

async function runHealth(runTests: boolean) {
  if (healthBusy) return;
  healthBusy = true;
  renderPanel();
  try {
    health = await api.health(runTests);
  } catch (e) {
    toast(errText(e), true);
  } finally {
    healthBusy = false;
    renderPanel();
  }
}

function renderHealth() {
  const sevClass: Record<string, string> = { critical: "failed", high: "failed", medium: "skipped", low: "pending", info: "done" };
  const head = h(
    "div",
    { class: "diff-toolbar" },
    h("b", { text: health ? `Health score ${health.score}/100` : "Repo health radar" }),
    h("div", { class: "spacer" }),
    h("button", { class: "btn ghost sm", disabled: healthBusy, onclick: () => runHealth(false), text: healthBusy ? "Scanning…" : "Scan" }),
    h("button", { class: "btn sm", disabled: healthBusy, onclick: () => runHealth(true), text: "Scan + run tests" }),
  );
  if (!health) {
    panelBodyEl.replaceChildren(head, panelEmpty("pulse", "Check this project's health", "Secrets, risky code, vulnerable dependencies, test status and hotspots, each with a one-click fix."));
    return;
  }
  panelBodyEl.replaceChildren(
    head,
    h("div", { class: "group-label", text: `${health.stats.sourceFiles} source files · ${health.stats.testFiles} test files` }),
    ...health.items.map((i) =>
      h(
        "div",
        { class: "agent" },
        h("div", { class: "agent-head" }, h("span", { class: `sdot ${sevClass[i.severity]}` }), h("span", { class: "agent-title", text: i.title }), h("span", { class: "agent-id", text: i.severity })),
        i.detail ? h("div", { class: "agent-feed" }, h("div", { text: i.detail })) : null,
        i.fixPrompt
          ? h("div", { class: "agent-meta" }, h("button", {
              class: "btn sm",
              disabled: busy,
              onclick: () => {
                if (busy) return toast("Stop the running agent first.", true);
                inputEl.value = i.fixPrompt!;
                autosize();
                void submit();
              },
            }, icon("sparkle"), "Fix with agent"))
          : null,
      ),
    ),
  );
}

async function refreshWorkingDiff() {
  try {
    diffText = await api.workingDiff();
    diffSource = "working";
    if (panelTab === "changes") renderPanel();
    else renderPanelHead();
  } catch {
    /* not critical */
  }
}

function renderChanges() {
  const files = parseDiff(diffText);
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  const toolbar = h(
    "div",
    { class: "diff-toolbar" },
    h("b", { text: diffSource === "result" ? "Parallel run result" : "Uncommitted changes" }),
    h("span", { class: "plus", text: `+${added}` }),
    h("span", { class: "minus", text: `−${removed}` }),
    h("div", { class: "spacer" }),
    h("button", { class: "btn ghost sm", onclick: refreshWorkingDiff, text: diffSource === "result" ? "Working tree" : "Refresh" }),
  );
  if (!files.length) {
    panelBodyEl.replaceChildren(toolbar, panelEmpty("diff", "No changes yet", "Edits made by agents appear here for review."));
    return;
  }
  panelBodyEl.replaceChildren(
    toolbar,
    ...files.map((f, i) => {
      const d = h(
        "details",
        { class: "diff-file", open: i < 6 },
        h("summary", {}, icon("file"), h("span", { class: "path", text: f.path }), f.status !== "modified" ? h("span", { class: "tag", text: f.status }) : null, h("span", { class: "plus", text: `+${f.added}` }), h("span", { class: "minus", text: `−${f.removed}` })),
      );
      d.append(h("div", { class: "diff-scroll", html: renderDiffFile(f) }));
      return d;
    }),
  );
}

function renderMeter() {
  if (!meterEl) return;
  const u = usage;
  const pct = u && u.contextWindow ? Math.min(1, u.contextTokens / u.contextWindow) : 0;
  const r = 7;
  const circ = 2 * Math.PI * r;
  const ring = h("span", {
    title: u?.contextWindow ? `Context: ${u.contextTokens.toLocaleString()} / ${u.contextWindow.toLocaleString()} tokens (${Math.round(pct * 100)}%)` : "Context window",
    html: `<svg class="ring" viewBox="0 0 18 18"><circle class="track" cx="9" cy="9" r="${r}"/><circle class="val" cx="9" cy="9" r="${r}" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - pct)}"/></svg>`,
  });
  meterEl.replaceChildren(
    h("span", { class: "cost", title: "Estimated spend this session", text: u?.costUsd != null ? `$${u.costUsd.toFixed(u.costUsd < 1 ? 3 : 2)}` : "$0.00" }),
    h("span", { class: "sep" }),
    h("span", { title: "Tokens in / out", text: u ? `${fmt(u.inputTokens)} in · ${fmt(u.outputTokens)} out` : "0 in · 0 out" }),
    ring,
  );
}

// ---- sessions ---------------------------------------------------------------------------------------

async function refreshSessions() {
  sessions = await api.sessions().catch(() => []);
  renderSessions();
}

function renderSessions() {
  if (!sideSessionsEl) return;
  if (!sessions.length) {
    sideSessionsEl.replaceChildren(h("div", { class: "side-empty", text: "Conversations in this project will appear here." }));
    return;
  }
  sideSessionsEl.replaceChildren(
    ...sessions.map((s) =>
      h(
        "button",
        { class: `side-item${s.id === activeSession ? " active" : ""}`, title: s.title, onclick: () => resume(s.id) },
        s.title,
        h("small", { text: relTime(s.updated) }),
      ),
    ),
  );
}

function relTime(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
}

async function resume(id: string) {
  if (busy) return toast("Stop the running agent first.", true);
  try {
    const messages = await api.resume(id);
    activeSession = id;
    colEl.replaceChildren();
    stepsEl = null;
    for (const m of messages) (m.role === "user" ? addUser : addAssistant)(m.text);
    renderSessions();
    scrollDown(true);
  } catch (e) {
    toast(errText(e), true);
  }
}

// ---- settings ------------------------------------------------------------------------------------

const MODEL_SUGGESTIONS = [
  "anthropic/claude-opus-5-5",
  "anthropic/claude-sonnet-5-5",
  "anthropic/claude-haiku-5-5",
  "anthropic/claude-fable-5-1",
  "ollama/gpt-oss:120b-cloud",
  "ollama/gpt-oss:20b-cloud",
  "ollama/qwen3-coder",
  "openrouter/anthropic/claude-sonnet-5.5",
];

async function openSettings() {
  if (document.querySelector(".overlay")) return;
  let settings: Settings;
  try {
    settings = await api.getSettings();
  } catch (e) {
    return toast(errText(e), true);
  }
  const close = () => overlay.remove();
  const roles: Array<[Role, string]> = [
    ["main", "Main agent"],
    ["planner", "Planner and reviewer"],
    ["worker", "Parallel workers"],
    ["explorer", "Research subagents"],
  ];
  const modelInputs = new Map<Role, HTMLInputElement>();
  const effortInputs = new Map<Role, HTMLSelectElement>();

  const keyRows = h("div");
  const renderKeys = () => {
    keyRows.replaceChildren(
      ...appState.providers
        .filter((p) => p.envVar)
        .map((p) => {
          const input = h("input", { class: "input mono", type: "password", placeholder: p.source === "none" ? p.envVar : "••••••••••••", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
          const save = async () => {
            try {
              appState = await api.setKey(p.name, input.value);
              toast(input.value ? `${p.name} key saved` : `${p.name} key removed`);
              renderKeys();
            } catch (e) {
              toast(errText(e), true);
            }
          };
          return h(
            "div",
            { class: "key-row" },
            h("span", { class: "name", text: p.name }),
            input,
            h("span", { class: `src${p.source !== "none" ? " ok" : ""}`, text: p.source === "env" ? "from env" : p.source === "app" ? "saved" : "not set" }),
            h("button", { class: "btn sm", onclick: save, text: "Save" }),
          );
        }),
    );
  };
  renderKeys();

  const parallel = h("input", { class: "input", type: "number", min: 1, max: 32, value: settings.maxParallel }) as HTMLInputElement;
  const verify = h("input", { class: "input mono", placeholder: "npm test", value: settings.verifyCommand }) as HTMLInputElement;
  const budget = h("input", { class: "input", type: "number", min: 0, step: "0.5", placeholder: "No limit", value: settings.budgetUsd ?? "" }) as HTMLInputElement;
  const permission = h(
    "select",
    { class: "input" },
    h("option", { value: "ask", text: "Ask before edits and commands", selected: settings.permission === "ask" }),
    h("option", { value: "auto", text: "Never ask (autonomous)", selected: settings.permission === "auto" }),
  ) as HTMLSelectElement;

  const save = async () => {
    const next: Settings = {
      models: Object.fromEntries(roles.map(([r]) => [r, modelInputs.get(r)!.value.trim() || settings.models[r]])) as Record<Role, string>,
      effort: Object.fromEntries(roles.map(([r]) => [r, effortInputs.get(r)!.value])) as Record<Role, string>,
      maxParallel: Number(parallel.value) || settings.maxParallel,
      verifyCommand: verify.value.trim(),
      permission: permission.value as "ask" | "auto",
      budgetUsd: budget.value ? Number(budget.value) : null,
    };
    try {
      const info = await api.saveSettings(next);
      if (info) project = info;
      close();
      toast("Settings saved");
      if (project) renderWorkspace();
    } catch (e) {
      toast(errText(e), true);
    }
  };

  const field = (label: string, control: HTMLElement) => h("label", {}, h("span", { class: "label", text: label }), control);
  const overlay = h(
    "div",
    { class: "overlay", onmousedown: (e: Event) => e.target === overlay && close() },
    h(
      "div",
      { class: "modal", role: "dialog", "aria-label": "Settings" },
      h("div", { class: "modal-head" }, h("h2", { text: "Settings" }), h("button", { class: "icon-btn", title: "Close (Esc)", onclick: close, html: svg("x") })),
      h(
        "div",
        { class: "modal-body" },
        h(
          "div",
          { class: "modal-section" },
          h("h3", { text: "Account" }),
          appState.account
            ? h("div", { class: "signin-card flat" }, avatarEl(appState.account), h("div", { class: "grow" }, h("b", { text: appState.account.name }), h("span", { text: appState.account.provider === "github" ? `GitHub${appState.account.login ? ` · @${appState.account.login}` : ""}` : `Google${appState.account.email ? ` · ${appState.account.email}` : ""}` })), h("button", { class: "btn ghost sm", onclick: () => (close(), signOut()), text: "Sign out" }))
            : h("div", { class: "row-left" }, h("button", { class: "btn signin", onclick: () => (close(), signIn("github")) }, h("span", { class: "icon", html: GITHUB_SVG }), "Sign in with GitHub"), h("button", { class: "btn signin", onclick: () => (close(), signIn("google")) }, h("span", { class: "icon", html: GOOGLE_SVG }), "Sign in with Google")),
        ),
        h(
          "div",
          { class: "modal-section" },
          h("h3", { text: "Models" }),
          h("p", { class: "hint", text: "Written as provider/model. A strong model plans and reviews; fast ones build and research." }),
          h("datalist", { id: "model-suggestions" }, ...MODEL_SUGGESTIONS.map((m) => h("option", { value: m }))),
          ...roles.map(([r, label]) => {
            const input = h("input", { class: "input mono", list: "model-suggestions", value: settings.models[r], spellcheck: "false" }) as HTMLInputElement;
            const effort = h("select", { class: "input" }, ...["low", "medium", "high", "xhigh", "max"].map((e) => h("option", { value: e, text: e, selected: settings.effort[r] === e }))) as HTMLSelectElement;
            modelInputs.set(r, input);
            effortInputs.set(r, effort);
            return h("div", { class: "role-row" }, field(label, input), field("Effort", effort));
          }),
        ),
        h(
          "div",
          { class: "modal-section" },
          h("h3", { text: "Behavior" }),
          h("p", { class: "hint", text: "Saved to ~/.swarmcode/config.json. A project's .swarmcode/config.json overrides these." }),
          h("div", { class: "grid2" }, field("Parallel agents", parallel), field("Permissions", permission), field("Verify command", verify), field("Budget per session (USD)", budget)),
        ),
        h(
          "div",
          { class: "modal-section" },
          h("h3", { text: "API keys" }),
          h("p", { class: "hint", text: appState.secureStorage ? "Encrypted with your OS keychain. Keys are only sent to their provider." : "Secure storage is unavailable; set keys as environment variables." }),
          keyRows,
        ),
      ),
      h("div", { class: "modal-foot" }, h("button", { class: "btn ghost", onclick: close, text: "Cancel" }), h("button", { class: "btn primary", onclick: save, text: "Save changes" })),
    ),
  );
  document.body.append(overlay);
}

void boot();
