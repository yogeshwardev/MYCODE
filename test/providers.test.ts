import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { openaiModel } from "../src/providers/openai.js";

// A minimal OpenAI-compatible streaming server that, like Ollama, rejects
// messages whose content is null.
function fakeServer(replies: string[]) {
  const bodies: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw);
      bodies.push(body);
      if (body.messages.some((m: { content: unknown }) => m.content === null)) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "invalid message content type: <nil>" } }));
      }
      const text = replies[bodies.length - 1] ?? "";
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (delta: object, finish: string | null) =>
        `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      res.write(chunk({ role: "assistant", content: text }, null));
      res.write(chunk({}, "stop"));
      res.end("data: [DONE]\n\n");
    });
  });
  return { server, bodies };
}

test("openai adapter never sends null content (empty replies are kept as strings)", async () => {
  const { server, bodies } = fakeServer(["", "second reply"]);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    const model = openaiModel("test/m", "test", "m", 100_000, { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: "x" });
    const session = model.createSession({ system: "sys", tools: [] });
    const first = await session.turn({ text: "hi" });
    assert.equal(first.text, "");
    const second = await session.turn({ text: "again" });
    assert.equal(second.text, "second reply");
    assert.equal(bodies[1].messages[2].content, "");
  } finally {
    server.close();
  }
});

test("trim shrinks older tool output and large call arguments, keeping recent ones", () => {
  const model = openaiModel("test/m", "test", "m", 100_000, { baseURL: "http://127.0.0.1:9/v1", apiKey: "x" });
  const session = model.createSession({ system: "s", tools: [] });
  const big = "x".repeat(5000);
  const history: unknown[] = [{ role: "user", content: "go" }];
  for (let i = 0; i < 6; i++) {
    history.push({ role: "assistant", content: "", tool_calls: [{ id: `c${i}`, type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: `f${i}.js`, content: big }) } }] });
    history.push({ role: "tool", tool_call_id: `c${i}`, content: i === 1 ? "short" : big });
  }
  session.importHistory(history);
  const stubbed: string[] = [];
  const removed = session.trim!({ keepRecent: 2, minChars: 1000, result: (id) => (stubbed.push(id), `[cleared ${id}]`) });
  const after = session.exportHistory() as Array<{ role: string; content?: string; tool_calls?: Array<{ function: { arguments: string } }> }>;
  const tools = after.filter((m) => m.role === "tool").map((m) => m.content);
  assert.deepEqual(stubbed, ["c0", "c2", "c3"]); // c1 is short; c4 and c5 are recent
  assert.deepEqual(tools, ["[cleared c0]", "short", "[cleared c2]", "[cleared c3]", big, big]);
  const args = after.flatMap((m) => m.tool_calls ?? []).map((c) => JSON.parse(c.function.arguments));
  assert.equal(args[0].path, "f0.js");
  assert.match(args[0].content, /5000 characters omitted/);
  assert.equal(args[5].content, big);
  assert.ok(removed > 6 * 4000);
});
