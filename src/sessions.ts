import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AgentState } from "./agent/agent.js";
import { SWARMCODE_HOME } from "./config.js";

// Interactive sessions are saved after every exchange under
// ~/.swarmcode/sessions/<project hash>/ so `swarm --continue` can pick up where
// you left off. They live outside the project so they never end up in git.

export interface SavedSession {
  id: string;
  root: string;
  title: string;
  created: string;
  updated: string;
  state: AgentState;
}

function dirFor(root: string): string {
  const hash = crypto.createHash("sha1").update(path.resolve(root).toLowerCase()).digest("hex").slice(0, 12);
  return path.join(SWARMCODE_HOME, "sessions", hash);
}

export function newSessionId(): string {
  return new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14) + "-" + crypto.randomBytes(2).toString("hex");
}

export function saveSession(root: string, id: string, state: AgentState) {
  if (!state.requests.length) return;
  const dir = dirFor(root);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.json`);
  const created = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as SavedSession).created : new Date().toISOString();
  const data: SavedSession = {
    id,
    root,
    title: state.requests[0].replace(/\s+/g, " ").slice(0, 80),
    created,
    updated: new Date().toISOString(),
    state,
  };
  // Write then rename, so a crash mid-write never corrupts a saved session.
  fs.writeFileSync(file + ".tmp", JSON.stringify(data));
  fs.renameSync(file + ".tmp", file);
}

export function listSessions(root: string): SavedSession[] {
  const dir = dirFor(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as SavedSession;
      } catch {
        return undefined;
      }
    })
    .filter((s): s is SavedSession => Boolean(s))
    .sort((a, b) => b.updated.localeCompare(a.updated));
}

export function loadSession(root: string, id?: string): SavedSession | undefined {
  const all = listSessions(root);
  return id ? all.find((s) => s.id === id || s.id.startsWith(id)) : all[0];
}
