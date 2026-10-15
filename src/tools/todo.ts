import type { Tool } from "./types.js";
import { ToolError } from "./types.js";

export interface TodoItem {
  text: string;
  status: "pending" | "in_progress" | "done";
}

const MARK: Record<TodoItem["status"], string> = { pending: "[ ]", in_progress: "[~]", done: "[x]" };

/**
 * A checklist the agent keeps for multi-step work. Rewriting the whole list
 * each time keeps it simple for every model; onChange lets front ends show it.
 */
export function makeTodoTool(onChange?: (items: TodoItem[]) => void): Tool {
  let items: TodoItem[] = [];
  return {
    readOnly: true,
    spec: {
      name: "todo",
      description:
        "Keep a checklist for work with 3 or more steps. Pass the full list each time (it replaces the previous one). Mark one item in_progress while you work on it and done when it is finished. Skip it for small tasks.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { text: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "done"] } },
              required: ["text", "status"],
            },
          },
        },
        required: ["items"],
      },
    },
    async run(input) {
      if (!Array.isArray(input.items)) throw new ToolError("items must be an array of {text, status}.");
      items = (input.items as Array<Record<string, unknown>>).slice(0, 50).map((i) => ({
        text: String(i.text ?? "").slice(0, 200),
        status: i.status === "done" || i.status === "in_progress" ? i.status : "pending",
      }));
      onChange?.(items);
      const done = items.filter((i) => i.status === "done").length;
      return `Checklist (${done}/${items.length} done):\n${items.map((i) => `${MARK[i.status]} ${i.text}`).join("\n")}`;
    },
  };
}
