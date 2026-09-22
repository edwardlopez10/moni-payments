# Commit Workflow (Lean)

## Purpose
Consistent, high-signal commit messages make diffs easier to review, enable clean history, and reduce cognitive load. This workflow defines how to stage, scope, write, and validate commits before pushing. It is self-contained and independent of PR conventions.

## Core Principles
- Each commit represents one logical change (atomic, reviewable).
- First line = actionable summary (verb first, present tense, no period).
- Prefer fewer, cleaner commits over noisy WIP fragments.
- Stage intentionally; avoid habitual `git add -A` in a dirty tree.
- History should tell "what changed"; deep rationale belongs in design docs or issue trackers.

## Message Format
```
<verb> <object> [optional scope/refinement]

<body (optional)>
```
Examples:
- add svg icons for docs navigation
- replace png icons with svg equivalents
- adjust spacing in overview feature section
- remove deprecated firewall png assets
- refactor pricing card layout

### Verbs (recommended)
add | remove | replace | migrate | update | refactor | fix | adjust | rename | optimize | cleanup

Avoid: implement, finished, done, temp, wip.

### Style Rules
- Lowercase first line.
- No trailing period.
- Imperative voice.
- Keep first line ≤ ~72 chars.
- Body only if it clarifies edge cases, split decisions, or partial follow-up needed.

## When to Use Multi-Line Messages
Add a brief body when:
- Explaining a non-obvious tradeoff.
- Noting follow-ups ("TODO: enrich RPC method docs").
- Describing partial migration boundaries.
Keep body wrapped at 72 columns; blank line between subject and body.

## Staging Workflow
1. Inspect status:
   ```bash
   git status
   ```
2. Review staged vs unstaged changes:
   ```bash
   git diff --cached
   git diff
   ```
3. Stage explicitly (examples):
   ```bash
   git add docs/docs/platform/overview.mdx
   git add docs/static/img/icons/*.svg
   ```
4. Avoid accidental noise:
   - Use path-specific adds over `git add -A` unless you are sure tree is clean.
   - Never commit editor swap/lock files or local environment artifacts.
5. Commit:
   ```bash
   git commit -m "replace png icons with svg equivalents"
   ```
6. Amend if you missed something (before push):
   ```bash
   git add <missed-file>
   git commit --amend --no-edit
   ```

## Grouping Guidance
- UI tweak + asset replacement = separate commits if independently reviewable.
- Generated code + manual edits = separate commits (e.g., script output vs hand changes).
- Pure rename with no content changes = its own commit (improves diff clarity).
- Large refactor: start with mechanical changes, then behavior changes.

## Squash vs Preserve
- Preserve multiple commits if each adds review signal.
- Squash noisy WIP, fixup, typo, or revert/apply churn before sharing or finalizing.

## Quality Checklist (pre-push)
[] Single logical change
[] Verb first, imperative, lowercase
[] No trailing period
[] No unintended files staged
[] Subject ≤ ~72 chars
[] Staged diff reviewed (`git diff --cached`)
[] Optional body only if it adds signal

## Amending & Fixups
- Use `--amend` for pre-push corrections.
- Use `git commit --fixup <sha>` + `git rebase -i --autosquash` for cleaning history late.

## Handling Mixed Changes
If you touched unrelated areas accidentally:
1. Unstage all: `git reset`
2. Add back intentionally by path.
3. Commit in logical sequence.

## Common Pitfalls
- Catch-all commits combining unrelated asset + logic + docs changes.
- Vague subjects ("update stuff", "changes", "wip").
- Committing before reviewing staged diff.
- Using PR-style prefixes (`feat(scope): ...`) in commit subjects (keep commits minimal).

## Example Session
```bash
# Make changes
vim docs/docs/platform/overview.mdx
cp _SVGs/*.svg docs/static/img/icons/

# Review and stage intentionally
git status
git add docs/static/img/icons/fast.svg docs/static/img/icons/stream.svg
git add docs/docs/platform/overview.mdx

# Commit
git commit -m "replace feature section png icons with svg versions"

# Add spacing adjustment missed initially
vim docs/docs/platform/overview.mdx

# Stage + amend
git add docs/docs/platform/overview.mdx
git commit --amend --no-edit

# Push when ready
git push -u origin sc-15517/feat-docs-reorg-rewrite
```

## When Unsure
Keep it smaller and cleaner. Ask: "Would a reviewer understand exactly what changed from this commit alone?" If not, refine or split.

---
Use this as a lightweight contract: clarity over ceremony. This file intentionally omits PR title conventions.

