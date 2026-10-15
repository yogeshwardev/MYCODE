---
name: git-workflow
description: Git and pull request workflows - clean commits, commit messages, PR descriptions, branching, rebasing, resolving conflicts, and recovering from git mistakes safely.
triggers: commit message, pull request description, pr description, rebase, merge conflict, cherry-pick, git history, squash, revert commit, undo commit
---
- **Inspect before acting**: `git status`, `git log --oneline -n 20 --graph`, `git diff --stat`. Know which branch you are on and whether there are uncommitted changes.
- **Never destroy work without explicit approval**: no `reset --hard`, `push --force`, `clean -fdx`, `branch -D` or history rewrites on shared branches unless the user asked for exactly that. Prefer `revert` over rewriting published history, and make a backup branch before risky operations (`git branch backup/<name>`).
- **Commit messages**: an imperative summary line of at most 72 characters (follow the repo's convention, e.g. Conventional Commits, if `git log` shows one), a blank line, then why the change was made. One logical change per commit.
- **PR descriptions**: what and why, how it was tested (commands and results), risk and rollback, screenshots for UI changes, linked issues. Keep it scannable.
- **Conflicts**: understand both sides' intent (`git log -p <file>` on each side), combine them rather than picking one blindly, remove every marker, then build and test before continuing the merge or rebase.
- **Recovery**: `git reflog` finds commits that look lost; `git restore` and `git switch` are safer than the older checkout forms.
