import { contextBridge, ipcRenderer } from "electron";
import type { Push, SwarmApi } from "./shared.js";

// The only bridge between the sandboxed UI and Node: a fixed set of calls.
const api: SwarmApi = {
  state: () => ipcRenderer.invoke("state"),
  openProject: (p) => ipcRenderer.invoke("openProject", p),
  send: (prompt, skills, guarantee, opts) => ipcRenderer.invoke("send", prompt, skills, guarantee, opts),
  review: (focus) => ipcRenderer.invoke("review", focus),
  auto: (goal, guarantee, skills) => ipcRenderer.invoke("auto", goal, guarantee, skills),
  health: (runTests) => ipcRenderer.invoke("health", runTests),
  undo: () => ipcRenderer.invoke("undo"),
  skills: () => ipcRenderer.invoke("skills"),
  swarm: (goal, guarantee) => ipcRenderer.invoke("swarm", goal, guarantee),
  bestOf: (goal, n, guarantee) => ipcRenderer.invoke("bestOf", goal, n, guarantee),
  abort: () => ipcRenderer.invoke("abort"),
  answer: (id, a) => ipcRenderer.invoke("answer", id, a),
  newConversation: () => ipcRenderer.invoke("newConversation"),
  sessions: () => ipcRenderer.invoke("sessions"),
  resume: (id) => ipcRenderer.invoke("resume", id),
  workingDiff: () => ipcRenderer.invoke("workingDiff"),
  getSettings: () => ipcRenderer.invoke("getSettings"),
  saveSettings: (s) => ipcRenderer.invoke("saveSettings", s),
  setKey: (provider, key) => ipcRenderer.invoke("setKey", provider, key),
  openExternal: (url) => ipcRenderer.invoke("openExternal", url),
  signIn: (provider) => ipcRenderer.invoke("signIn", provider),
  cancelSignIn: () => ipcRenderer.invoke("cancelSignIn"),
  signOut: () => ipcRenderer.invoke("signOut"),
  onPush: (cb) => {
    const listener = (_e: unknown, p: Push) => cb(p);
    ipcRenderer.on("push", listener);
    return () => ipcRenderer.removeListener("push", listener);
  },
};

contextBridge.exposeInMainWorld("swarm", api);
