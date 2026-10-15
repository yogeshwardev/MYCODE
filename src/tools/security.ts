import fs from "node:fs";
import path from "node:path";
import { confine, listFiles } from "../util.js";
import type { Tool } from "./types.js";

// A fast, dependency-free first pass for security work: hardcoded secrets and
// well-known risky code patterns. It is a triage aid, not a proof of safety;
// the security skills tell the agent to confirm every finding by reading the
// code and to use dedicated scanners (semgrep, npm audit, ...) when available.

type Severity = "high" | "medium" | "low";

interface Rule {
  id: string;
  title: string;
  severity: Severity;
  kind: "secret" | "code";
  re: RegExp;
  /** File extensions the rule applies to (all files when omitted). */
  ext?: string[];
}

const JS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte"];
const PY = [".py"];
const SHELLISH = [".sh", ".bash", ".zsh", ".ps1", ".yml", ".yaml", ""];

const RULES: Rule[] = [
  // ---- secrets ----
  { id: "aws-key", title: "AWS access key", severity: "high", kind: "secret", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: "github-token", title: "GitHub token", severity: "high", kind: "secret", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/ },
  { id: "slack-token", title: "Slack token", severity: "high", kind: "secret", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { id: "stripe-live", title: "Stripe live key", severity: "high", kind: "secret", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/ },
  { id: "google-api-key", title: "Google API key", severity: "high", kind: "secret", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "llm-api-key", title: "API secret key (sk-...)", severity: "high", kind: "secret", re: /\bsk-(?:ant-|proj-|or-|[a-z]+-)?[A-Za-z0-9_-]{24,}/ },
  { id: "private-key", title: "Private key", severity: "high", kind: "secret", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/ },
  { id: "url-credentials", title: "Credentials in connection URL", severity: "medium", kind: "secret", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/'"]+:[^\s@/'"]{3,}@/i },
  { id: "jwt", title: "Hardcoded JWT", severity: "medium", kind: "secret", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  {
    id: "hardcoded-secret",
    title: "Hardcoded password/secret",
    severity: "medium",
    kind: "secret",
    re: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\w*["']?\s*[:=]\s*["'](?!\$\{|<|your|changeme|example|xxx|placeholder|\*+["'])[^"'\s]{8,}["']/i,
  },

  // ---- JavaScript / TypeScript ----
  { id: "js-eval", title: "Dynamic code execution (eval)", severity: "high", kind: "code", re: /(?<![\w.])eval\s*\(/, ext: JS },
  { id: "js-new-function", title: "Dynamic code execution (new Function)", severity: "medium", kind: "code", re: /\bnew Function\s*\(/, ext: JS },
  { id: "js-cmd-injection", title: "Shell command built from variables (command injection)", severity: "high", kind: "code", re: /\b(?:exec|execSync|spawn|spawnSync)\s*\(\s*(?:`[^`]*\$\{|[^,)'"`]+\+|["'][^"']*["']\s*\+)/, ext: JS },
  { id: "js-xss", title: "Unsafe HTML sink (XSS)", severity: "medium", kind: "code", re: /\.(?:innerHTML|outerHTML)\s*=|dangerouslySetInnerHTML|document\.write\s*\(|insertAdjacentHTML\s*\(/, ext: JS },
  { id: "js-sqli", title: "SQL built with string concatenation/interpolation (SQL injection)", severity: "high", kind: "code", re: /(?:\b(?:query|execute|raw)\s*\(\s*`[^`]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{)|(?:["'`]\s*(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[^"'`]*["'`]\s*\+)/i, ext: JS },
  { id: "js-tls-off", title: "TLS certificate verification disabled", severity: "high", kind: "code", re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0/, ext: JS },
  { id: "js-weak-random", title: "Math.random used for a security value", severity: "medium", kind: "code", re: /(?:token|secret|password|nonce|salt|otp|key)\w*\s*[:=][^;\n]*Math\.random/i, ext: JS },
  { id: "js-weak-hash", title: "Weak hash (MD5/SHA-1)", severity: "medium", kind: "code", re: /createHash\(\s*["'](?:md5|sha1)["']/i, ext: JS },
  { id: "js-cors-any", title: "CORS allows any origin", severity: "low", kind: "code", re: /origin\s*:\s*["']\*["']|Access-Control-Allow-Origin["']?\s*,\s*["']\*["']/, ext: JS },
  { id: "js-path-traversal", title: "File path built from request input (path traversal)", severity: "medium", kind: "code", re: /\b(?:readFile|readFileSync|createReadStream|sendFile)\s*\([^)]*\breq\.(?:params|query|body)/, ext: JS },

  // ---- Python ----
  { id: "py-eval", title: "Dynamic code execution (eval/exec)", severity: "high", kind: "code", re: /(?<![\w.])(?:eval|exec)\s*\(/, ext: PY },
  { id: "py-shell-true", title: "subprocess with shell=True (command injection)", severity: "high", kind: "code", re: /subprocess\.\w+\([^)]*shell\s*=\s*True/, ext: PY },
  { id: "py-os-system", title: "os.system / os.popen", severity: "medium", kind: "code", re: /\bos\.(?:system|popen)\s*\(/, ext: PY },
  { id: "py-pickle", title: "Unsafe deserialization (pickle)", severity: "medium", kind: "code", re: /\bpickle\.loads?\s*\(/, ext: PY },
  { id: "py-yaml-load", title: "yaml.load without SafeLoader", severity: "medium", kind: "code", re: /\byaml\.load\s*\((?![^)]*SafeLoader)/, ext: PY },
  { id: "py-tls-off", title: "TLS verification disabled (verify=False)", severity: "high", kind: "code", re: /verify\s*=\s*False/, ext: PY },
  { id: "py-sqli", title: "SQL built with f-string/format/concatenation (SQL injection)", severity: "high", kind: "code", re: /\.execute\(\s*(?:f["']|["'][^"']*["']\s*(?:%|\+|\.format))/, ext: PY },
  { id: "py-weak-hash", title: "Weak hash (MD5/SHA-1)", severity: "medium", kind: "code", re: /hashlib\.(?:md5|sha1)\s*\(/, ext: PY },
  { id: "py-debug", title: "Debug mode enabled", severity: "low", kind: "code", re: /^\s*DEBUG\s*=\s*True\b|app\.run\([^)]*debug\s*=\s*True/, ext: PY },

  // ---- Go / Java / PHP / C# ----
  { id: "go-tls-off", title: "TLS verification disabled (InsecureSkipVerify)", severity: "high", kind: "code", re: /InsecureSkipVerify\s*:\s*true/, ext: [".go"] },
  { id: "go-shell", title: "Command run through a shell", severity: "medium", kind: "code", re: /exec\.Command\(\s*"(?:sh|bash|cmd)"\s*,\s*"(?:-c|\/c)"/, ext: [".go"] },
  { id: "java-exec", title: "Runtime.exec (command injection risk)", severity: "medium", kind: "code", re: /Runtime\.getRuntime\(\)\.exec\s*\(/, ext: [".java", ".kt"] },
  { id: "java-weak-hash", title: "Weak hash (MD5/SHA-1)", severity: "medium", kind: "code", re: /MessageDigest\.getInstance\(\s*"(?:MD5|SHA-?1)"/i, ext: [".java", ".kt"] },
  { id: "php-shell", title: "Shell execution", severity: "high", kind: "code", re: /\b(?:shell_exec|system|passthru|proc_open|popen)\s*\(\s*\$/, ext: [".php"] },
  { id: "php-unserialize", title: "Unsafe deserialization (unserialize)", severity: "medium", kind: "code", re: /\bunserialize\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE)/, ext: [".php"] },
  { id: "cs-sqli", title: "SQL built with concatenation (SQL injection)", severity: "high", kind: "code", re: /new SqlCommand\(\s*"[^"]*"\s*\+/, ext: [".cs"] },

  // ---- shell / CI / containers ----
  { id: "curl-pipe-sh", title: "Remote script piped to a shell", severity: "medium", kind: "code", re: /\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:sh|bash)\b/, ext: [...SHELLISH, ".dockerfile"] },
  { id: "chmod-777", title: "World-writable permissions (chmod 777)", severity: "low", kind: "code", re: /\bchmod\s+(?:-R\s+)?777\b/, ext: [...SHELLISH, ".dockerfile"] },
];

const SKIP = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum|composer\.lock)$|\.min\.(?:js|css)$|\.(?:png|jpe?g|gif|ico|pdf|zip|gz|woff2?|ttf|exe|dll|so|dylib|map)$/i;

function extOf(file: string) {
  const base = path.basename(file).toLowerCase();
  if (base === "dockerfile" || base.endsWith(".dockerfile")) return ".dockerfile";
  return path.extname(base);
}

/** Show enough of a secret to locate it, never enough to use it. */
function mask(s: string) {
  return s.length <= 8 ? "****" : `${s.slice(0, 4)}${"*".repeat(Math.min(16, s.length - 4))}`;
}

export interface Finding {
  rule: string;
  title: string;
  severity: Severity;
  kind: "secret" | "code";
  file: string;
  line: number;
  excerpt: string;
}

export async function scan(root: string, opts: { path?: string; kinds?: Array<"secret" | "code">; files?: string[] } = {}): Promise<Finding[]> {
  const base = opts.path ? confine(root, opts.path) : root;
  const prefix = opts.path ? path.relative(root, base).split(path.sep).join("/") : "";
  const candidates = opts.files ?? (await listFiles(root));
  const files = candidates.filter((f) => !prefix || f === prefix || f.startsWith(prefix + "/")).filter((f) => !SKIP.test(f));
  const kinds = new Set(opts.kinds ?? ["secret", "code"]);
  const rules = RULES.filter((r) => kinds.has(r.kind));
  const findings: Finding[] = [];
  for (const f of files) {
    const full = path.join(root, f);
    let text: string;
    try {
      if (fs.statSync(full).size > 1_000_000) continue;
      text = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    const ext = extOf(f);
    const applicable = rules.filter((r) => !r.ext || r.ext.includes(ext));
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 2000) continue;
      for (const r of applicable) {
        const m = r.re.exec(line);
        if (!m) continue;
        const excerpt = r.kind === "secret" ? line.replace(m[0], mask(m[0])).trim() : line.trim();
        findings.push({ rule: r.id, title: r.title, severity: r.severity, kind: r.kind, file: f, line: i + 1, excerpt: excerpt.slice(0, 200) });
      }
    }
  }
  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || a.line - b.line);
}

export const securityScan: Tool = {
  readOnly: true,
  spec: {
    name: "security_scan",
    description:
      "Scan the project (or a sub-path) for hardcoded secrets and risky code patterns: injection (SQL, command), XSS sinks, eval, unsafe deserialization, disabled TLS verification, weak hashes and random numbers, and more, across JS/TS, Python, Go, Java, PHP, C#, shell and Docker. Secrets are masked in the output. Findings are leads that need confirming by reading the code.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File or directory to scan (default: whole project)" },
        kind: { type: "string", enum: ["all", "secrets", "code"], description: "Default: all" },
        max_results: { type: "integer", description: "Default 100" },
      },
    },
  },
  async run(input, ctx) {
    const kind = String(input.kind ?? "all");
    const kinds: Array<"secret" | "code"> = kind === "secrets" ? ["secret"] : kind === "code" ? ["code"] : ["secret", "code"];
    const findings = await scan(ctx.root, { path: input.path ? String(input.path) : undefined, kinds });
    const note = "Heuristic scan: confirm each finding in context. No findings is not proof of security.";
    if (!findings.length) return `No findings. ${note}`;
    const max = Number(input.max_results ?? 100);
    const counts = { high: 0, medium: 0, low: 0 };
    for (const f of findings) counts[f.severity]++;
    const lines = findings.slice(0, max).map((f) => `${f.severity.toUpperCase().padEnd(6)} ${f.file}:${f.line}  ${f.title} [${f.rule}]\n        ${f.excerpt}`);
    return `${findings.length} finding(s): ${counts.high} high, ${counts.medium} medium, ${counts.low} low.\n\n${lines.join("\n")}${findings.length > max ? `\n... ${findings.length - max} more` : ""}\n\n${note}`;
  },
};
