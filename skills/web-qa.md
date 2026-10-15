---
name: web-qa
description: Test a web app end to end in a real browser - start the dev server, walk the user flows, check console and network errors, responsive layouts and accessibility basics, and report or fix what breaks.
triggers: test the ui, test the app, end to end, e2e, browser, click through, check the page, does it render, smoke test, qa, playwright, localhost
---
Use the browser tools to verify a web app the way a careful QA engineer would.

1. **Run it.** Find the dev command (package.json scripts, Makefile, README). Start it with `bash` and `background: true`, then use `process_output` (with `wait_ms`) until it prints its URL. If it fails to start, read the error and fix that first.
2. **Open it** with `browser_navigate` at the local URL. Check `browser_console` straight away: uncaught errors, failed requests and HTTP 4xx/5xx responses are bugs.
3. **Walk the flows** the task cares about with `browser_click` and `browser_type` (refs come from the latest snapshot). Use obviously fake test data, never real credentials or personal data. After each step, check that the page shows what it should and that no new console errors appeared.
4. **Edge cases**: empty and invalid form input, very long text, double submits, back navigation, refresh mid-flow, and failed API calls where they can be simulated.
5. **Layout and accessibility basics**: every interactive element has a readable label in the snapshot, the main flows work with the keyboard alone (Tab/Enter), and nothing important is missing at a mobile width. Take screenshots with `browser_screenshot` when layout matters.
6. **Fix or report.** If asked to fix, fix the root cause in the code, reload and re-run the failing flow to prove it. Otherwise report each problem with steps to reproduce, expected vs actual result, and console evidence.
7. **Clean up**: stop the dev server with `process_stop` when you are done.
