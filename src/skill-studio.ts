import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Agent } from "./agent/agent.js";
import type { EventSink, UsageTracker } from "./agent/events.js";
import { SWARMCODE_HOME } from "./config.js";
import type { ModelHandle } from "./providers/types.js";
import { parseSkill, type Skill } from "./skills.js";
import { clip } from "./util.js";

// Skill studio: capture what worked in a session as a reusable skill, and
// share skills safely. A skill is instructions an agent will follow, so
// imported skills are shown in full, pinned by SHA-256, and can be required to
// carry an Ed25519 signature from a trusted key.

const STUDIO_PROMPT = `You turn a successful AI coding session into a reusable SKILL: a concise expert playbook another agent can follow for similar tasks in the future.

Generalize: keep the approach, the order of steps, the checks that caught problems, the commands and conventions that mattered for this kind of project, and the pitfalls hit along the way. Remove one-off details (specific variable names, ticket numbers) unless they are conventions. Never include secrets, credentials or personal data.

Output ONLY the skill file, in exactly this format:
---
name: <kebab-case-name>
description: <one sentence: what it does and when to use it>
triggers: <comma-separated words or short phrases a request would contain>
---
<numbered steps and short bullet points; under 400 words>`;

export async function createSkillFromSession(opts: {
  transcript: Array<{ role: string; text: string }>;
  name?: string;
  model: ModelHandle;
  root: string;
  events: EventSink;
  usage: UsageTracker;
}): Promise<Skill> {
  if (!opts.transcript.length) throw new Error("This session has no conversation yet to turn into a skill.");
  const conversation = clip(opts.transcript.map((m) => `## ${m.role}\n${m.text}`).join("\n\n"), 60_000);
  const writer = new Agent({
    name: "skill-studio",
    model: opts.model,
    system: STUDIO_PROMPT,
    tools: [],
    ctx: { root: opts.root, approve: async () => true },
    events: opts.events,
    usage: opts.usage,
    maxTurns: 1,
  });
  const text = (await writer.run(`${opts.name ? `Name the skill "${opts.name}".\n\n` : ""}<session>\n${conversation}\n</session>`)).trim();
  const body = text.slice(Math.max(0, text.indexOf("---")));
  const skill = parseSkill(body.replace(/```\s*$/, "").trim(), "project");
  if (!skill) throw new Error("The model did not produce a valid skill file; try again.");
  if (opts.name) skill.name = opts.name;
  return skill;
}

export function skillToMarkdown(s: Skill): string {
  return `---\nname: ${s.name}\ndescription: ${s.description}\ntriggers: ${s.triggers.join(", ")}\n---\n${s.body}\n`;
}

export function saveSkill(s: Skill, dir: string): string {
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(s.name)) throw new Error(`Invalid skill name "${s.name}": use lowercase letters, digits and dashes.`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${s.name}.md`);
  fs.writeFileSync(file, skillToMarkdown(s));
  return file;
}

export const projectSkillDir = (root: string) => path.join(root, ".swarmcode", "skills");
export const userSkillDir = () => path.join(SWARMCODE_HOME, "skills");

export const sha256 = (data: Buffer | string) => crypto.createHash("sha256").update(data).digest("hex");

export interface FetchedSkill {
  skill: Skill;
  text: string;
  hash: string;
  /** "valid" when signed by a trusted key, "none" when unsigned. */
  signature: "valid" | "invalid" | "none";
  signer?: string;
}

async function readSource(src: string): Promise<Buffer> {
  if (/^https:\/\//.test(src)) {
    const res = await fetch(src, { redirect: "follow" });
    if (!res.ok) throw new Error(`Could not download ${src}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  if (/^http:\/\//.test(src)) throw new Error("Only https URLs are allowed for skills.");
  return fs.readFileSync(src);
}

/** Download (https) or read a skill, verify its hash pin and signature, and parse it. Nothing is installed. */
export async function fetchSkill(src: string, opts: { expectSha256?: string; trustedKeys?: string[] } = {}): Promise<FetchedSkill> {
  const data = await readSource(src);
  if (data.length > 100_000) throw new Error("Skill file is too large (over 100 KB).");
  const text = data.toString("utf8");
  const hash = sha256(data);
  if (opts.expectSha256 && opts.expectSha256.toLowerCase() !== hash) throw new Error(`SHA-256 mismatch: expected ${opts.expectSha256}, got ${hash}. Not installing.`);
  const skill = parseSkill(text, "user");
  if (!skill) throw new Error("Not a valid skill file (it needs frontmatter with name and description).");

  let signature: FetchedSkill["signature"] = "none";
  let signer: string | undefined;
  const sig = await readSource(`${src}.sig`).catch(() => undefined);
  if (sig) {
    signature = "invalid";
    for (const pem of opts.trustedKeys ?? []) {
      try {
        if (crypto.verify(null, data, crypto.createPublicKey(pem), Buffer.from(sig.toString("utf8").trim(), "base64"))) {
          signature = "valid";
          signer = sha256(crypto.createPublicKey(pem).export({ type: "spki", format: "der" })).slice(0, 16);
          break;
        }
      } catch {
        /* malformed key: try the next one */
      }
    }
  }
  return { skill, text, hash, signature, signer };
}

/** Generate an Ed25519 key pair for signing skills. Returns the file paths. */
export function generateSigningKey(dir: string): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  fs.mkdirSync(dir, { recursive: true });
  const priv = path.join(dir, "swarmcode-skill-signing.key.pem");
  const pub = path.join(dir, "swarmcode-skill-signing.pub.pem");
  fs.writeFileSync(priv, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  fs.writeFileSync(pub, publicKey.export({ type: "spki", format: "pem" }));
  return { privateKey: priv, publicKey: pub };
}

/** Sign a skill file; writes <file>.sig next to it. */
export function signSkillFile(file: string, privateKeyPem: string): string {
  const sig = crypto.sign(null, fs.readFileSync(file), crypto.createPrivateKey(privateKeyPem)).toString("base64");
  fs.writeFileSync(`${file}.sig`, sig + "\n");
  return `${file}.sig`;
}
