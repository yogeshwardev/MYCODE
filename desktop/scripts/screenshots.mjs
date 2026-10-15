// Captures product screenshots for the website from the real UI running on its
// scripted demo backend (dist-preview):
//   node build.mjs --preview && npx electron scripts/screenshots.mjs
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const page = path.join(here, "..", "dist-preview", "renderer", "index.html");
const out = path.join(here, "..", "..", "website", "assets");
fs.mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, useContentSize: true, show: false, paintWhenInitiallyHidden: true, backgroundColor: "#000000" });
  const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  const shot = async (name) => {
    // Let the page paint the latest state before capturing.
    await js("await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
    await sleep(1200);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, name), img.toPNG());
    console.log("wrote", name, img.getSize());
  };
  await win.loadFile(page);
  await sleep(500);
  await js(`document.querySelector(".preview-banner")?.remove(); document.body.classList.add("os-darwin");`);

  // 1. Welcome
  await shot("welcome.png");

  // 2. Swarm run in progress
  await js(`
    document.querySelector(".welcome-actions .btn.primary").click();
    await new Promise(r => setTimeout(r, 500));
    document.querySelector(".preview-banner")?.remove();
    const ta = document.querySelector("textarea");
    ta.value = "/swarm"; ta.setSelectionRange(6, 6); ta.dispatchEvent(new Event("input"));
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    ta.value = "Add rate limiting to the public API with per-route config, docs and tests";
    ta.dispatchEvent(new Event("input"));
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise(r => setTimeout(r, 1600));
    document.querySelector(".card.attention .btn.primary").click();
    await new Promise(r => setTimeout(r, 1700));
    document.querySelector(".transcript").scrollTop = 0;
  `);
  await shot("agents.png");

  // 3. Changes ready + diff review
  await sleep(4500);
  await js(`document.querySelector(".card.attention")?.scrollIntoView({ block: "end" });`);
  await shot("review.png");

  // 4. Command palette
  await js(`
    document.querySelector(".card.attention .btn.primary")?.click();
    await new Promise(r => setTimeout(r, 1500));
    document.querySelector(".side-top .btn").click();
    await new Promise(r => setTimeout(r, 500));
    const ta = document.querySelector("textarea");
    ta.onblur = null;
    ta.value = "Generate a PDF report of this quarter's sales /"; ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.dispatchEvent(new Event("input"));
  `);
  await shot("commands.png");

  // 5. Health radar
  await js(`
    const ta = document.querySelector("textarea"); ta.value = ""; ta.dispatchEvent(new Event("input")); ta.blur();
    [...document.querySelectorAll(".panel-head .seg button")][2].click();
    await new Promise(r => setTimeout(r, 200));
    [...document.querySelectorAll(".panel-body .btn")][0].click();
    await new Promise(r => setTimeout(r, 600));
  `);
  await shot("health.png");
  app.exit(0);
});
