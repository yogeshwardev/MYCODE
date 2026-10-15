import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scan, type Finding } from "../tools/security.js";

// The security merge gate: findings that a change *introduces* (not ones that
// were already there) are surfaced before the change is reported done, so a
// fix never quietly ships a hardcoded secret, an injection or disabled TLS.

export interface ChangedFile {
  /** Path relative to the root, forward slashes. */
  rel: string;
  /** Content before the change (null = the file is new). */
  before: Buffer | string | null;
}

const key = (f: Finding) => `${f.rule}|${f.file}|${f.excerpt.replace(/\s+/g, " ")}`;

/** Gate-worthy: any high-severity finding, and every secret. */
const blocking = (f: Finding) => f.severity === "high" || f.kind === "secret";

export async function introducedFindings(root: string, files: ChangedFile[]): Promise<Finding[]> {
  const present = files.filter((f) => fs.existsSync(path.join(root, f.rel)));
  if (!present.length) return [];
  const after = (await scan(root, { files: present.map((f) => f.rel) })).filter(blocking);
  if (!after.length) return [];

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcode-gate-"));
  try {
    for (const f of present) {
      if (f.before === null) continue;
      const dest = path.join(tmp, f.rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.before);
    }
    const before = await scan(tmp, { files: present.filter((f) => f.before !== null).map((f) => f.rel) });
    // Count-based diff so a finding that merely moved lines is not "new".
    const remaining = new Map<string, number>();
    for (const b of before) remaining.set(key(b), (remaining.get(key(b)) ?? 0) + 1);
    return after.filter((a) => {
      const n = remaining.get(key(a)) ?? 0;
      if (n > 0) {
        remaining.set(key(a), n - 1);
        return false;
      }
      return true;
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function describeFindings(findings: Finding[]): string {
  return findings.map((f) => `- ${f.severity.toUpperCase()} ${f.file}:${f.line} ${f.title} [${f.rule}]\n  ${f.excerpt}`).join("\n");
}

export const GATE_INSTRUCTIONS =
  "The security gate found issues introduced by your changes:\n\n{findings}\n\n" +
  "Fix each real issue properly (e.g. read secrets from environment variables, use parameterized queries, keep TLS verification on). " +
  "If a finding is a false positive (e.g. a test fixture or a placeholder), leave it and explain why in one sentence. Then run the relevant tests and give your final summary.";
