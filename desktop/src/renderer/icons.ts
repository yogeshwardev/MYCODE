// One consistent icon set: 24px grid, 1.6px strokes, round joins.
const P: Record<string, string> = {
  mark: '<path d="M5 5c4 0 5 7 12 7M5 12h12M5 19c4 0 5-7 12-7" stroke-width="2"/><circle cx="4.8" cy="5" r="2.5" fill="currentColor" stroke="none"/><circle cx="4.8" cy="12" r="2.5" fill="currentColor" stroke="none"/><circle cx="4.8" cy="19" r="2.5" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="3.8" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  folder: '<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.6l2 2h7.4a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M14.5 4.5v15"/>',
  undo: '<path d="M9 13.5 4.5 9 9 4.5"/><path d="M4.5 9H14a5.5 5.5 0 0 1 0 11h-3"/>',
  arrowUp: '<path d="M12 19V5.5M6 11l6-6 6 6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  terminal: '<path d="m5.5 8 4 4-4 4M12 16.5h6.5"/>',
  file: '<path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z"/><path d="M13.5 3.5V9H19"/>',
  pencil: '<path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-4-4l-10 10z"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m19.5 19.5-4-4"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4.5 3.5"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6"/><circle cx="12" cy="16.8" r=".9" fill="currentColor" stroke="none"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>',
  shield: '<path d="M12 3.5 5 6.5v5.2c0 4.3 2.9 7.3 7 8.8 4.1-1.5 7-4.5 7-8.8V6.5z"/>',
  agents: '<path d="M5.5 5.5c4 0 5 6.5 11 6.5M5.5 12h11M5.5 18.5c4 0 5-6.5 11-6.5"/><circle cx="5" cy="5.5" r="1.8"/><circle cx="5" cy="12" r="1.8"/><circle cx="5" cy="18.5" r="1.8"/><circle cx="18" cy="12" r="2.4"/>',
  sparkle: '<path d="M12 3.5 13.7 9 19 10.5 13.7 12 12 17.5 10.3 12 5 10.5 10.3 9z"/><path d="M18.5 16v4M16.5 18h4"/>',
  key: '<circle cx="8" cy="15" r="3.5"/><path d="m10.5 12.5 8-8M15.5 7.5l2.5 2.5"/>',
  diff: '<path d="M12 4.5v7M8.5 8h7M8.5 18.5h7"/>',
  list: '<path d="M9 6.5h10.5M9 12h10.5M9 17.5h10.5"/><circle cx="5" cy="6.5" r=".9" fill="currentColor"/><circle cx="5" cy="12" r=".9" fill="currentColor"/><circle cx="5" cy="17.5" r=".9" fill="currentColor"/>',
  alert: '<path d="M12 4 3 19.5h18z"/><path d="M12 10v4.5M12 17v.01"/>',
  bug: '<rect x="7.5" y="7.5" width="9" height="12" rx="4.5"/><path d="M12 11v8.5M4.5 13h3M16.5 13h3M5 8.5l2.5 1.5M19 8.5 16.5 10M9.5 7.5 8 5M14.5 7.5 16 5"/>',
  book: '<path d="M5 5.5A2 2 0 0 1 7 3.5h12v14H7a2 2 0 0 0-2 2z"/><path d="M5 19.5a2 2 0 0 0 2 2h12v-4"/>',
  layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  bolt: '<path d="M13 3.5 5.5 13H11l-1 7.5 7.5-9.5H12z"/>',
  shieldCheck: '<path d="M12 3.5 5 6.5v5.2c0 4.3 2.9 7.3 7 8.8 4.1-1.5 7-4.5 7-8.8V6.5z"/><path d="m9 12 2 2 4-4"/>',
  pulse: '<path d="M3.5 12h4l2-5 4 10 2-5h5"/>',
  branch: '<circle cx="7" cy="6" r="2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="8" r="2"/><path d="M7 8v8M17 10c0 4-4 4.5-8.5 7"/>',
};

export function svg(name: keyof typeof P | string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ""}</svg>`;
}

export function icon(name: string, cls = "icon"): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = cls;
  el.innerHTML = svg(name); // trusted constant markup
  return el;
}

/** Icon for a tool step in the transcript. */
export function toolIcon(tool: string): string {
  if (tool === "bash" || tool.startsWith("process_")) return "terminal";
  if (tool.startsWith("browser_")) return "globe";
  if (tool === "edit_file" || tool === "write_file") return "pencil";
  if (tool === "read_file" || tool === "list_dir") return "file";
  if (tool === "grep" || tool === "glob") return "search";
  if (tool === "web_fetch") return "globe";
  if (tool === "security_scan") return "shield";
  if (tool === "delegate" || tool === "swarm") return "agents";
  if (tool === "use_skill") return "sparkle";
  return "layers";
}
