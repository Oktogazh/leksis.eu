# Leksis — instructions for Claude

Leksis (leksis.eu) is a distributed, crowdsourced multilingual dictionary for
low-resource languages, built on AT Protocol and ArangoDB. Turborepo monorepo:
`apps/api` (Hono AppView), `apps/web` (React/Vite), `packages/types` (shared contract).

## Orient first

- Load the **`leksis`** skill for architecture facts (stack, lexicon, ArangoDB schema)
  and the **`leksis-evolution`** skill for process (roadmap position, scope test,
  recording rules) before advising on any Leksis work. Never guess architecture facts.
- Project subagents in `.claude/agents/`: **scout** (find code), **planner** (design a
  milestone/feature plan), **reviewer** (pre-commit diff review with Leksis guardrails).
  All read-only. Delegate to them; keep implementation in the main session.

## Working method

The user works, sequentially, step by step and keeps control of what happens and when. Make all changes directly on the current branch without creating worktrees, needing PR etc...

1. **Orient** — establish where the project stands (evolution skill step 1).
2. **Propose** — before any non-trivial change, state what you intend to change, in
   which files, and why. Wait for confirmation on anything beyond the agreed step.
3. **Implement the smallest slice** — one step at a time; each step leaves the repo
   typechecking and deployable. No "while I was here" additions: unplanned work is
   proposed, not slipped in.
4. **Verify** — per `.claude/skills/verify/SKILL.md`. A change is done when the affected
   flow has been exercised and proof shown, not when it compiles.
5. **Record** — match the change to its home (CHANGELOG / ADR / skill update) per
   evolution skill step 4.
6. Always work directly on the master branch. Do not create worktrees or spawn parallel subagents unless explicitly asked.


## Verification rules

- A PostToolUse hook (`.claude/hooks/verify-edit.sh`) typechecks and lints the touched
  workspace after every edit. Fix its feedback immediately — do not accumulate errors.
- Changes to `packages/types` require the full `npm run typecheck` (all workspaces).
- UI changes are verified in the browser preview (server `web`, port 5173); API changes
  by curling the affected endpoint with ArangoDB running. See the verify skill.

## Hard stops — never without explicit user approval

- `git commit`, `git push`, and above all **`git tag` / `git push --tags`**: pushing a
  tag triggers the GitHub Actions deploy to the production VPS. Treat tagging as a
  production deploy, because it is one.
- Deleting or migrating data in ArangoDB (superseded versions are archived with
  `current: false`; the only sanctioned removal is an `entries` version whose
  record was deleted from its author's PDS — see the reviewer agent's guardrails).
- Editing production/infra files: `docker-compose.yml`, `Caddyfile`, `.github/workflows`.
