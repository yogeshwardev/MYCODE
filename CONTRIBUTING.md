# Contributing

1. `npm install`, then `npm run typecheck && npm test`. The tests include end-to-end runs of the parallel pipeline with scripted models, so they need no API key.
2. Keep `src/engine.ts` as the single API that the CLI (`src/index.ts`) and the desktop app (`desktop/`) use.
3. New providers: if it speaks the OpenAI chat-completions API, add it to `BUILTIN_PROVIDERS` in `src/config.ts`. Otherwise implement `ModelHandle`/`ChatSession` in `src/providers/`.
4. New tools: add them to `src/tools/index.ts`. Mark read-only tools `readOnly` so they can run in parallel and be given to research subagents.
5. Behavior changes that affect speed, cost or quality should come with numbers from `npm run bench`.
