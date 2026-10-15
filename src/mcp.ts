import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { JSONSchema } from "./providers/types.js";
import { ToolError, type Tool } from "./tools/index.js";
import { clip } from "./util.js";

// MCP client: any Model Context Protocol server (databases, browsers, issue
// trackers, docs, ...) becomes a set of tools for every agent. Config uses the
// same shape as other MCP clients:
//   "mcpServers": { "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] },
//                   "docs":   { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer ..." } } }

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Tools from this server never ask for approval. */
  trusted?: boolean;
  disabled?: boolean;
}

export interface McpConnection {
  tools: Tool[];
  errors: string[];
  close(): Promise<void>;
}

const sanitize = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");

export async function connectMcp(servers: Record<string, McpServerConfig>, cwd: string): Promise<McpConnection> {
  const clients: Client[] = [];
  const tools: Tool[] = [];
  const errors: string[] = [];

  await Promise.all(
    Object.entries(servers).map(async ([name, cfg]) => {
      if (cfg.disabled) return;
      try {
        const client = new Client({ name: "swarmcode", version: "1.0.0" });
        const transport = cfg.url
          ? new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers ?? {} } })
          : new StdioClientTransport({
              command: cfg.command ?? "",
              args: cfg.args ?? [],
              env: { ...getDefaultEnvironment(), ...(cfg.env ?? {}) },
              cwd,
              stderr: "ignore",
            });
        await withTimeout(client.connect(transport), 30_000, `connecting to MCP server "${name}"`);
        clients.push(client);
        const listed = await client.listTools();
        for (const t of listed.tools) {
          tools.push(wrapTool(client, name, t.name, t.description ?? "", t.inputSchema as JSONSchema, Boolean(cfg.trusted)));
        }
      } catch (err) {
        errors.push(`${name}: ${(err as Error).message}`);
      }
    }),
  );

  return {
    tools,
    errors,
    close: async () => {
      await Promise.allSettled(clients.map((c) => c.close()));
    },
  };
}

function wrapTool(client: Client, server: string, name: string, description: string, schema: JSONSchema, trusted: boolean): Tool {
  const fullName = `mcp__${sanitize(server)}__${sanitize(name)}`.slice(0, 64);
  return {
    readOnly: false,
    spec: {
      name: fullName,
      description: `[MCP server "${server}"] ${description}`.slice(0, 1024),
      parameters: { type: "object", properties: schema?.properties ?? {}, required: schema?.required },
    },
    async run(input, ctx) {
      if (!trusted && !(await ctx.approve("mcp", `${server}.${name} ${JSON.stringify(input).slice(0, 200)}`))) {
        throw new ToolError("User declined the MCP tool call.");
      }
      const result = await client.callTool({ name, arguments: input }, undefined, { timeout: 300_000 });
      const parts: string[] = [];
      for (const item of (result.content ?? []) as Array<Record<string, unknown>>) {
        if (item.type === "text") parts.push(String(item.text));
        else if (item.type === "resource") parts.push(JSON.stringify(item.resource));
        else parts.push(`[${item.type} content omitted]`);
      }
      if (result.structuredContent && !parts.length) parts.push(JSON.stringify(result.structuredContent));
      const text = clip(parts.join("\n") || "(no output)");
      if (result.isError) throw new ToolError(text);
      return text;
    },
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out ${what}`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
