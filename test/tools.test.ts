import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { BROWSER_TOOLS, closeBrowsers } from "../src/tools/browser.js";
import { CORE_TOOLS } from "../src/tools/index.js";
import { processOutput, processStop, stopProcesses } from "../src/tools/processes.js";
import { loadSkills, suggestSkills } from "../src/skills.js";

const tool = (name: string) => [...CORE_TOOLS, ...BROWSER_TOOLS].find((t) => t.spec.name === name)!;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "swarmcode-tools-"));

after(async () => {
  stopProcesses();
  await closeBrowsers();
});

test("bash background: start a server, read its output, stop it", { timeout: 30_000 }, async () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, "server.js"), "console.log('ready on 1234'); setInterval(() => console.log('tick'), 200);\n");
  const ctx = { root, approve: async () => true };
  const started = await tool("bash").run({ command: "node server.js", background: true }, ctx);
  assert.match(started, /Started background process (p\d+)/);
  assert.match(started, /ready on 1234/);
  const id = /process (p\d+)/.exec(started)![1];
  assert.match(await processOutput.run({ id, wait_ms: 1000 }, ctx), /tick/);
  assert.match(await processOutput.run({}, ctx), new RegExp(`${id} \\[running`));
  assert.match(await processStop.run({ id }, ctx), /Stopped/);
  await assert.rejects(processOutput.run({ id }, ctx), /No background process/);
});

test("browser tools: navigate, read, type, click and catch console errors", { timeout: 90_000 }, async (t) => {
  const page = `<!doctype html><title>Demo</title>
    <h1>Counter</h1><p id="out">clicked 0</p>
    <input aria-label="Name" id="name"><button id="b">Add  one   suggestions</button>
    <script>let n=0;document.getElementById('b').onclick=()=>{n++;document.getElementById('out').textContent='clicked '+n+' by '+document.getElementById('name').value;};
    console.error('demo error');</script>`;
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === "/" ? 200 : 404, { "content-type": "text/html" });
    res.end(req.url === "/" ? page : "nope");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const ctx = { root: tmp(), approve: async () => true };
  try {
    let snap: string;
    try {
      snap = await tool("browser_navigate").run({ url }, ctx);
    } catch (err) {
      if (/No usable browser/.test((err as Error).message)) return t.skip("no Chrome/Edge installed");
      throw err;
    }
    assert.match(snap, /Title: Demo/);
    assert.match(snap, /clicked 0/);
    // Whitespace runs in labels collapse to single spaces, and letters survive.
    const ref = /\[ref=(\d+)\] button "Add one suggestions"/.exec(snap)?.[1];
    const inputRef = /\[ref=(\d+)\] input\[text\] "Name"/.exec(snap)?.[1];
    assert.ok(ref && inputRef, snap);
    await tool("browser_type").run({ ref: Number(inputRef), value: "Ada" }, ctx);
    const after = await tool("browser_click").run({ ref: Number(ref) }, ctx);
    assert.match(after, /clicked 1 by Ada/);
    assert.match(await tool("browser_console").run({}, ctx), /console\.error: demo error/);
    assert.match(await tool("browser_screenshot").run({}, ctx), /Saved \.swarmcode\/screenshots\/shot-\d+\.png/);
  } finally {
    server.close();
  }
});

test("skill suggestions match requests to the right playbooks", () => {
  const skills = loadSkills(tmp());
  const top = (q: string) => suggestSkills(q, skills)[0]?.name;
  assert.equal(top("review the auth service for vulnerabilities"), "security-review");
  assert.equal(top("write sigma rules for this lateral movement"), "detection-engineering");
  assert.equal(top("is this npm package malicious?"), "suspicious-code-triage");
  assert.equal(top("test the checkout flow in the browser"), "web-qa");
  assert.equal(suggestSkills("hello there", skills).length, 0);
});

test("documents: generate a PDF from Markdown, then read it back page by page", { timeout: 90_000 }, async (t) => {
  const { generatePdf, readDocument, parsePages } = await import("../src/tools/documents.js");
  assert.deepEqual(parsePages("1-3,7,2", 5), [1, 2, 3]);
  assert.deepEqual(parsePages(undefined, 2), [1, 2]);
  const ctx = { root: tmp(), approve: async () => true };
  const md = "# Quarterly Report\n\nRevenue grew **12%**.\n\n| Region | Sales |\n|---|---|\n| North | 120 |\n| South | 95 |\n\n<!-- pagebreak -->\n\n## Appendix\n\nDetails on page two.";
  try {
    assert.match(await generatePdf.run({ output: "out/report.pdf", content: md }, ctx), /Created out\/report\.pdf/);
  } catch (err) {
    if (/No usable browser/.test((err as Error).message)) return t.skip("no Chrome/Edge installed");
    throw err;
  }
  const all = await readDocument.run({ path: "out/report.pdf" }, ctx);
  assert.match(all, /\[PDF: 2 page\(s\)\]/);
  assert.match(all, /Quarterly Report/);
  assert.match(all, /North/);
  const second = await readDocument.run({ path: "out/report.pdf", pages: "2" }, ctx);
  assert.match(second, /Details on page two/);
  assert.doesNotMatch(second, /Quarterly Report/);
});
