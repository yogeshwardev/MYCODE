import fs from "node:fs";
import path from "node:path";
import { git, gitOk } from "../swarm/git.js";
import { run } from "../util.js";
import { latestProof } from "./proof.js";

// `swarm pr`: put the current changes on a new branch, push it, and open a
// pull request whose description is the latest proof report, so reviewers see
// the evidence (tests, hidden tests, review, security gate) next to the diff.

export interface PrOptions {
  title?: string;
  base?: string;
  draft?: boolean;
}

export interface PrPlan {
  branch: string;
  title: string;
  base?: string;
  files: string[];
  proof?: string;
}

/** Work out what `openPullRequest` would do, without changing anything. */
export async function planPullRequest(root: string, opts: PrOptions = {}): Promise<PrPlan> {
  const status = (await gitOk(root, ["status", "--porcelain"])).split("\n").filter(Boolean);
  if (!status.length) throw new Error("There are no uncommitted changes to put in a pull request.");
  const gh = await run("gh", ["--version"], { cwd: root });
  if (gh.code !== 0) throw new Error("The GitHub CLI (gh) is required: install it from https://cli.github.com and run `gh auth login`.");
  const remote = await git(root, ["remote", "get-url", "origin"]);
  if (remote.code !== 0) throw new Error("This repository has no `origin` remote to push to.");
  const proof = latestProof(root);
  let title = opts.title;
  if (!title && proof) {
    const json = proof.replace(/\.md$/, ".json");
    if (fs.existsSync(json)) title = String(JSON.parse(fs.readFileSync(json, "utf8")).request ?? "").replace(/\s+/g, " ").slice(0, 72);
  }
  title ||= "Changes by SwarmCode";
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "changes";
  return { branch: `swarm/${slug}-${Date.now().toString(36)}`, title, base: opts.base, files: status.map((l) => l.slice(3)), proof: proof ? path.relative(root, proof).split(path.sep).join("/") : undefined };
}

/** Create the branch, commit, push and open the PR. Returns the PR URL. */
export async function openPullRequest(root: string, plan: PrPlan, opts: PrOptions = {}): Promise<string> {
  await gitOk(root, ["switch", "-c", plan.branch]);
  await gitOk(root, ["add", "-A"]);
  await gitOk(root, ["commit", "-q", "-m", plan.title]);
  const push = await run("git", ["push", "-u", "origin", plan.branch], { cwd: root, timeoutMs: 120_000 });
  if (push.code !== 0) throw new Error(`git push failed: ${(push.stderr || push.stdout).trim()}`);
  const args = ["pr", "create", "--title", plan.title, "--head", plan.branch];
  if (plan.proof) args.push("--body-file", path.join(root, plan.proof));
  else args.push("--body", "Changes made with SwarmCode.");
  if (plan.base) args.push("--base", plan.base);
  if (opts.draft) args.push("--draft");
  const pr = await run("gh", args, { cwd: root, timeoutMs: 120_000 });
  if (pr.code !== 0) throw new Error(`gh pr create failed: ${(pr.stderr || pr.stdout).trim()}`);
  return pr.stdout.trim().split("\n").pop() ?? "";
}
