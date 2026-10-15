// Renders build/icon.svg to build/icon.png (1024x1024) using Electron itself:
//   npx electron scripts/make-icon.mjs
// The SVG is drawn onto a fixed-size canvas in the page, so the result does not
// depend on the display's scaling factor.
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build");
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(dir, "icon.svg"), "utf8");
  const win = new BrowserWindow({ show: false });
  await win.loadURL("data:text/html,<html><body></body></html>");
  const dataUrl = await win.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = 1024; c.height = 1024;
        c.getContext("2d").drawImage(img, 0, 0, 1024, 1024);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = "data:image/svg+xml;base64," + ${JSON.stringify(Buffer.from(svg).toString("base64"))};
    })`);
  fs.writeFileSync(path.join(dir, "icon.png"), Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("wrote build/icon.png");
  app.exit(0);
});
