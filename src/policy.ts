import { ToolError, type ApprovalKind } from "./tools/types.js";
import { globToRegExp } from "./util.js";

/**
 * Permission rules, checked before anything is approved:
 *   { "deny": ["bash:git push*"], "allow": ["bash:npm test*", "write:src/**"] }
 * A rule is "<kind>:<pattern>" (kind: write, bash, mcp, web, swarm, or *).
 * For bash the pattern matches the command; for write, the file path.
 */
export interface PermissionRules {
  allow?: string[];
  deny?: string[];
}

export type Decision = "allow" | "deny" | "ask";

/** Commands that can destroy work or systems. They always need a human. */
const DESTRUCTIVE: Array<[RegExp, string]> = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|--force\s+--recursive)\b[^|;&]*\s(\/|~|\$HOME|\/\*|\.\.?\/?)(\s|$)/i, "recursive delete of a root, home or parent folder"],
  [/\bgit\s+push\b[^|;&]*(\s--force\b|\s-f\b|\s--force-with-lease\b|\s\+\S)/i, "force push"],
  [/\bgit\s+reset\s+--hard\b/i, "git reset --hard (discards uncommitted work)"],
  [/\bgit\s+clean\s+-[a-z]*f/i, "git clean (deletes untracked files)"],
  [/\bgit\s+(branch\s+-D|push\s+\S+\s+--delete|push\s+\S+\s+:)/i, "deleting a branch"],
  [/\b(mkfs(\.\w+)?|fdisk|diskpart|format\s+[a-z]:)/i, "formatting a disk"],
  [/\bdd\b[^|;&]*\bof=\/dev\//i, "writing to a raw device"],
  [/\b(shutdown|reboot|halt|poweroff)\b/i, "shutting down the machine"],
  [/\bdrop\s+(database|schema|table)\b/i, "dropping database objects"],
  [/\b(curl|wget|iwr|invoke-webrequest)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|iex|invoke-expression|python3?)\b/i, "running a downloaded script"],
  [/\bchmod\s+(-R\s+)?777\s+\//i, "making system files world-writable"],
  [/\b(Remove-Item|rd|rmdir)\b[^|;&]*(-Recurse|\/s)[^|;&]*\s([a-z]:\\?|\\|~|\$HOME|\$env:USERPROFILE)(\s|$)/i, "recursive delete of a drive or home folder"],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, "fork bomb"],
];

/** Read-only commands allowed in plan mode. */
const READ_ONLY_COMMAND =
  /^\s*(git\s+(status|log|diff|show|branch(\s+(-a|--list|-r))?|blame|ls-files|rev-parse|remote\s+-v)\b|ls\b|dir\b|cat\b|type\b|head\b|tail\b|wc\b|grep\b|rg\b|find\b(?!.*-(delete|exec))|tree\b|pwd\b|echo\b|which\b|where\b|node\s+(-v|--version)\b|npm\s+(ls|view|outdated|--version)\b|python3?\s+--version\b|cargo\s+(tree|--version)\b|go\s+(list|version)\b)/i;

/** Why a command is destructive, or undefined if it isn't. */
export function destructiveReason(command: string): string | undefined {
  return DESTRUCTIVE.find(([re]) => re.test(command))?.[1];
}

export function isReadOnlyCommand(command: string): boolean {
  // Any chaining, redirection or substitution could hide a write.
  if (/[;&|`>]|\$\(/.test(command.replace(/\s+2>&1\s*$/, ""))) return false;
  return READ_ONLY_COMMAND.test(command);
}

/** The thing a rule pattern is matched against, from an approval summary. */
export function approvalSubject(kind: ApprovalKind, summary: string): string {
  if (kind === "bash") return summary.replace(/\s+\(in the background\)$/, "");
  if (kind === "write") return summary.replace(/^(Create|Overwrite|Edit|Delete)\s+/, "").replace(/\s+\(\d+ changes\)$/, "");
  return summary;
}

function matches(rule: string, kind: ApprovalKind, subject: string): boolean {
  const i = rule.indexOf(":");
  const ruleKind = i < 0 ? "*" : rule.slice(0, i);
  const pattern = i < 0 ? rule : rule.slice(i + 1);
  if (ruleKind !== "*" && ruleKind !== kind) return false;
  if (kind === "bash") {
    // Command patterns: * matches anything (including spaces and slashes).
    const re = new RegExp(`^${pattern.trim().replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");
    return re.test(subject.trim());
  }
  return globToRegExp(pattern).test(subject.replace(/\\/g, "/"));
}

/**
 * Decide an approval request before asking anyone. Order: deny rules, plan
 * mode, destructive commands (always a human), allow rules, then the default.
 */
export function decide(
  kind: ApprovalKind,
  summary: string,
  opts: { rules?: PermissionRules; auto: boolean; planMode?: boolean },
): { decision: Decision; reason?: string } {
  const subject = approvalSubject(kind, summary);
  const rule = (list?: string[]) => list?.find((r) => matches(r, kind, subject));
  const denied = rule(opts.rules?.deny);
  if (denied) return { decision: "deny", reason: `blocked by the deny rule "${denied}"` };
  if (opts.planMode) {
    if (kind === "bash" && isReadOnlyCommand(subject)) return { decision: "allow" };
    if (kind === "web") return { decision: opts.auto ? "allow" : "ask" };
    return { decision: "deny", reason: "plan mode is read-only: describe the change in your plan instead of making it" };
  }
  const allowed = rule(opts.rules?.allow);
  if (kind === "bash") {
    const danger = destructiveReason(subject);
    // An explicit allow rule is a deliberate choice; auto mode is not.
    if (danger && !allowed) return opts.auto ? { decision: "deny", reason: `destructive command (${danger}) needs a person to approve it` } : { decision: "ask", reason: danger };
  }
  if (allowed) return { decision: "allow" };
  return { decision: opts.auto ? "allow" : "ask" };
}

/**
 * Approval for agents that run without a person (parallel workers, merge and
 * fix agents, best-of candidates): allowed unless a deny rule or the
 * destructive-command check says no.
 */
export function unattendedApprover(rules?: PermissionRules) {
  return async (kind: ApprovalKind, summary: string): Promise<boolean> => {
    const { decision, reason } = decide(kind, summary, { rules, auto: true });
    if (decision === "deny") throw new ToolError(`Not allowed: ${reason}.`);
    return true;
  };
}
