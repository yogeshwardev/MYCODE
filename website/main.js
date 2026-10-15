(() => {
  const cfg = window.SWARMCODE_SITE || {};
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // Config-driven bits
  if (cfg.downloadUrl) $$("[data-download]").forEach((a) => (a.href = cfg.downloadUrl));
  if (cfg.version) $$("[data-version]").forEach((el) => (el.textContent = "v" + cfg.version));
  if (cfg.installerSize) $$("[data-size]").forEach((el) => (el.textContent = cfg.installerSize));
  if (cfg.repoUrl) $$(".repo-link").forEach((a) => { a.href = cfg.repoUrl; a.hidden = false; });
  const year = $("#year");
  if (year) year.textContent = new Date().getFullYear();

  // Screenshot tabs
  const shot = $("#shot");
  $$(".tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      $$(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      shot.src = `/assets/${b.dataset.shot}.png`;
      shot.alt = `SwarmCode: ${b.textContent}`;
    }),
  );

  // Benchmarks
  const cards = $("#bench-cards");
  if (!cards) return;
  const fmtS = (s) => (s == null ? "–" : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
  const fmtT = (t) => (t == null ? "n/a" : t >= 1000 ? `${Math.round(t / 1000)}k` : String(Math.round(t)));

  fetch("/benchmarks.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then(render)
    .catch(() => {
      cards.innerHTML = `<div class="bench-empty">Benchmark results are being updated. Run them yourself with <code>npm run bench</code>.</div>`;
    });

  function headline(data) {
    // Token ratio vs Codex, only on tasks where both runners reported tokens.
    const us = data.runners.filter((r) => r.runner.startsWith("swarmcode"));
    let best = null;
    for (const r of us) {
      let mine = 0, theirs = 0;
      for (const t of data.tasks) {
        const a = t.results.find((x) => x.runner === r.runner);
        const b = t.results.find((x) => x.runner === "codex");
        if (a?.tokens && b?.tokens) { mine += a.tokens; theirs += b.tokens; }
      }
      if (mine && theirs && (!best || theirs / mine > best.ratio)) best = { ratio: theirs / mine, name: r.name };
    }
    if (best && best.ratio >= 1.2) {
      $("#stat-tokens").textContent = `${best.ratio.toFixed(1)}× fewer`;
      $("#stat-tokens-label").textContent = `tokens than Codex CLI on the same tasks (${best.name})`;
    }
    const top = us.sort((a, b) => b.passed - a.passed)[0];
    if (top) {
      $("#stat-pass").textContent = `${top.passed}/${top.total}`;
      $("#stat-pass-label").textContent = `real tasks passed, graded by hidden tests (${top.name})`;
    }
  }

  function render(data) {
    headline(data);
    const runners = data.runners;
    cards.innerHTML = runners
      .map((r) => {
        const us = r.runner.startsWith("swarmcode");
        const pct = r.total ? Math.round((r.passed / r.total) * 100) : 0;
        return `<div class="bcard${us ? " us" : ""}">
          <div class="name"><span>${esc(r.name)}</span>${us ? '<span class="tag">ours</span>' : ""}</div>
          <div class="big">${r.passed}<small> / ${r.total} passed</small></div>
          <div class="bar"><i style="width:${pct}%"></i></div>
          <dl>
            <dt>Avg time</dt><dd>${fmtS(r.avgSeconds)}</dd>
            <dt>Avg tokens</dt><dd>${r.avgTokens == null ? "not reported" : fmtT(r.avgTokens)}</dd>
            ${["small", "medium", "large"]
              .filter((c) => r.byCategory[c])
              .map((c) => `<dt>${c[0].toUpperCase() + c.slice(1)} tasks</dt><dd>${r.byCategory[c].passed}/${r.byCategory[c].total}</dd>`)
              .join("")}
          </dl>
        </div>`;
      })
      .join("");

    const head = `<thead><tr><th>Task</th>${runners.map((r) => `<th>${esc(r.name)}</th>`).join("")}</tr></thead>`;
    const body = data.tasks
      .map(
        (t) => `<tr><td class="task">${esc(t.title)}<span class="cat">${esc(t.category)}</span></td>${t.results
          .map((x) =>
            x.passed == null
              ? `<td class="res"><span class="t">–</span></td>`
              : `<td class="res"><span class="${x.passed ? "ok" : "no"}">${x.passed ? "✓ pass" : "✗ fail"}</span><span class="t">${fmtS(x.seconds)}${x.tokens != null ? " · " + fmtT(x.tokens) + " tok" : ""}</span></td>`,
          )
          .join("")}</tr>`,
      )
      .join("");
    $("#bench-table").insertAdjacentHTML("beforeend", head + `<tbody>${body}</tbody>`);

    const when = new Date(data.generatedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    $("#bench-meta").innerHTML = `Model for every tool: <b>${esc(data.model)}</b>. Run on ${esc(when)}. ${esc(data.note)} Token counts are shown only where a tool reports them.`;
  }
})();
