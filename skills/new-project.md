---
name: new-project
description: Start a new app or service from scratch - pick a sensible stack, scaffold it with the official tools, and set up linting, tests, environment config, git and a README so it is ready to build on.
triggers: new project, new app, scaffold, bootstrap, create a, start a, from scratch, boilerplate, starter, set up a, initialize, init project
---
1. **Clarify only what changes the stack**: platform (web, mobile, desktop, API, CLI), language preference, and must-have integrations. Otherwise choose mainstream, well-supported defaults and state them.
2. **Scaffold with the official generator** where one exists (e.g. `npm create vite@latest`, `npx create-next-app`, `npm create astro`, `django-admin startproject`, `cargo new`, `go mod init`, `flutter create`, `npx create-expo-app`). Run generators non-interactively with explicit flags.
3. **Baseline quality**: formatter and linter, a test runner with one passing example test, type checking where the language supports it, `.gitignore`, `.env.example` (never real secrets), and scripts for dev, build, test and lint.
4. **Structure**: a clear folder layout for the chosen framework, configuration from environment variables, and error handling and logging from day one.
5. **Verify**: install dependencies, run the dev server in the background (`bash` with `background: true`) and open it with the browser tools for web apps; run lint, type check and tests.
6. **Hand-off**: a README with setup, run, test and deploy steps; `git init` with an initial commit if the user wants it; and a short list of sensible next steps. Save the build and test commands with `remember`.
