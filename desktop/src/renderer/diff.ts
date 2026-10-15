import { escapeHtml } from "./markdown.js";

export interface DiffFile {
  path: string;
  status: "added" | "deleted" | "modified" | "renamed" | "binary";
  added: number;
  removed: number;
  lines: string[];
}

export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const chunk of diff.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith("diff --git ")) continue;
    const lines = chunk.replace(/\n$/, "").split("\n");
    const header = /^diff --git a\/(.*?) b\/(.*)$/.exec(lines[0]);
    let p = header?.[2] ?? lines[0].slice(11);
    let status: DiffFile["status"] = "modified";
    let added = 0;
    let removed = 0;
    const body: string[] = [];
    let inHunk = false;
    for (const l of lines.slice(1)) {
      if (!inHunk) {
        if (l.startsWith("new file")) status = "added";
        else if (l.startsWith("deleted file")) status = "deleted";
        else if (l.startsWith("rename to ")) {
          status = "renamed";
          p = l.slice(10);
        } else if (l.startsWith("Binary files")) status = "binary";
        else if (l.startsWith("+++ ") && l !== "+++ /dev/null") p = l.replace(/^\+\+\+ (b\/)?/, "");
        if (l.startsWith("@@")) inHunk = true;
        else continue;
      }
      if (l.startsWith("+")) added++;
      else if (l.startsWith("-")) removed++;
      body.push(l);
    }
    files.push({ path: p, status, added, removed, lines: body });
  }
  return files;
}

const MAX_LINES = 1500;

export function renderDiffFile(f: DiffFile): string {
  const rows: string[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const l of f.lines.slice(0, MAX_LINES)) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      rows.push(`<tr class="hunk"><td></td><td></td><td>${escapeHtml(l)}</td></tr>`);
      continue;
    }
    const kind = l[0] === "+" ? "add" : l[0] === "-" ? "del" : "ctx";
    const a = kind === "add" ? "" : String(oldNo++);
    const b = kind === "del" ? "" : String(newNo++);
    rows.push(`<tr class="${kind}"><td class="ln">${a}</td><td class="ln">${b}</td><td>${escapeHtml(l) || " "}</td></tr>`);
  }
  if (f.lines.length > MAX_LINES) rows.push(`<tr class="hunk"><td></td><td></td><td>… ${f.lines.length - MAX_LINES} more lines</td></tr>`);
  return `<table class="diff-table">${rows.join("")}</table>`;
}
