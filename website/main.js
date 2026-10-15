(() => {
  const cfg = window.SWARMCODE_SITE || {};
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // Config-driven bits
  // Download buttons go to /download, which starts the download and shows install steps.
  if (cfg.version) $$("[data-version]").forEach((el) => (el.textContent = "v" + cfg.version));
  if (cfg.installerSize) $$("[data-size]").forEach((el) => (el.textContent = cfg.installerSize));
  // Copy the CLI install command.
  const copy = $("#copy-install");
  copy?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#install-cmd").textContent.trim());
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Select and copy";
    }
    setTimeout(() => (copy.textContent = "Copy"), 1800);
  });

  // GitHub star count (best effort; the link works without it).
  fetch("https://api.github.com/repos/yogeshwardev/MYCODE")
    .then((r) => (r.ok ? r.json() : null))
    .then((repo) => {
      const stars = $("#stars");
      if (!repo || typeof repo.stargazers_count !== "number" || !stars) return;
      stars.textContent = `★ ${repo.stargazers_count.toLocaleString()}`;
      stars.hidden = false;
    })
    .catch(() => undefined);
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
})();
