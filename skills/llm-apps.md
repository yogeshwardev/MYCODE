---
name: llm-apps
description: Build features on top of LLMs - prompts, tool calling, structured outputs, RAG, agents, evaluation, cost and safety - using the provider SDKs in the project.
triggers: llm, prompt, openai, anthropic, claude, gpt, gemini, rag, embedding, vector, chatbot, eval, fine-tun, tool calling, structured output
---
1. **Use the project's SDK and check its current docs** (`web_fetch`) before writing calls: model names, parameters and API shapes change often. Don't hand-roll HTTP when an official SDK is in use.
2. **Prompts**: a stable system prompt (cacheable), a clear task and output format, examples where they help, and untrusted input clearly delimited. Prefer structured outputs or tool schemas over parsing free text.
3. **Retrieval (RAG)**: chunk by document structure, store sources with chunks, retrieve then re-rank, cite sources in answers, and handle "no relevant context" explicitly.
4. **Reliability**: timeouts, retries with backoff for rate limits and 5xx only, streaming for long outputs, validation of model output before acting on it, and graceful fallbacks.
5. **Safety**: treat model output as untrusted (never eval it, or pass it to SQL or a shell directly); defend against prompt injection from retrieved or user content; never put secrets in prompts; log responsibly.
6. **Evaluate**: build a small eval set from realistic inputs with expected outcomes, and measure quality, latency and cost before and after prompt or model changes.
7. **Cost**: pick the smallest model that meets the quality bar, cache stable prefixes, cap output tokens, and batch offline work.
