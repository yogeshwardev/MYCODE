import fs from "node:fs";
import path from "node:path";
import { clip } from "../util.js";
import type { Tool } from "../tools/types.js";

// Two ways to get far more out of a fixed context window:
//
// 1. The journal keeps everything an agent saw and said (requests, replies,
//    full tool results) outside the model's context. After compaction the
//    model's history is a short handoff note, but the `recall` tool can still
//    search the whole session, so nothing is truly lost.
//
// 2. Offloading: very large tool outputs (build logs, test runs, big greps) are
//    saved to a file and only their head and tail enter the context, with the
//    path so the agent can read exactly the part it needs.

interface Entry {
  seq: number;
  kind: "request" | "reply" | "tool";
  text: string;
}

const MAX_JOURNAL_CHARS = 4_000_000;
const words = (t: string) => t.toLowerCase().split(/[^a-z0-9_./-]+/).filter((w) => w.length > 2);

export class Journal {
  private entries: Entry[] = [];
  private seq = 0;
  private size = 0;

  add(kind: Entry["kind"], text: string) {
    if (!text.trim()) return;
    const entry = { seq: ++this.seq, kind, text: clip(text, 40_000) };
    this.entries.push(entry);
    this.size += entry.text.length;
    while (this.size > MAX_JOURNAL_CHARS && this.entries.length > 1) this.size -= this.entries.shift()!.text.length;
  }

  get length() {
    return this.entries.length;
  }

  clear() {
    this.entries = [];
    this.size = 0;
  }

  /** Best-matching entries for a query: keyword overlap, exact phrase bonus, recency tie-break. */
  search(query: string, max = 6): Entry[] {
    const q = words(query);
    const phrase = query.toLowerCase().trim();
    if (!q.length && !phrase) return [];
    return this.entries
      .map((e) => {
        const lower = e.text.toLowerCase();
        let score = phrase.length > 3 && lower.includes(phrase) ? 10 : 0;
        for (const w of new Set(q)) if (lower.includes(w)) score += 1 + Math.min(3, lower.split(w).length - 2);
        return { e, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.e.seq - a.e.seq)
      .slice(0, max)
      .map((x) => x.e)
      .sort((a, b) => a.seq - b.seq);
  }
}

export function makeRecallTool(journal: Journal): Tool {
  return {
    readOnly: true,
    spec: {
      name: "recall",
      description:
        "Search everything from earlier in this session (requests, your replies, and full tool results such as file contents and command output), including what was dropped from your context by compaction. Use it instead of redoing work when you need a detail you saw before.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keywords, a file path, a function name or an error message" },
          max_results: { type: "integer", description: "Default 6" },
        },
        required: ["query"],
      },
    },
    async run(input) {
      const hits = journal.search(String(input.query), Math.min(20, Number(input.max_results ?? 6)));
      if (!hits.length) return "Nothing in this session's history matches.";
      return hits.map((h) => `--- #${h.seq} (${h.kind}) ---\n${clip(h.text, 4000)}`).join("\n\n");
    },
  };
}

const OFFLOAD_CHARS = 12_000;
const KEEP_CHARS = 3_000;
let offloadSeq = 0;

/** Save a huge tool output to a file and return a compact head/tail view pointing at it. */
export function offload(output: string, root: string, label: string): string {
  if (output.length <= OFFLOAD_CHARS) return output;
  try {
    const rel = path.join(".swarmcode", "outputs", `${label.replace(/[^\w-]+/g, "_").slice(0, 40)}-${Date.now()}-${++offloadSeq}.txt`);
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, output);
    const lines = output.split("\n").length;
    const relPosix = rel.split(path.sep).join("/");
    return `${output.slice(0, KEEP_CHARS)}\n\n... [${output.length - 2 * KEEP_CHARS} characters omitted: the full output (${lines} lines) is saved at ${relPosix}; read the part you need with read_file and offset/limit, or grep it] ...\n\n${output.slice(-KEEP_CHARS)}`;
  } catch {
    return clip(output, OFFLOAD_CHARS);
  }
}
