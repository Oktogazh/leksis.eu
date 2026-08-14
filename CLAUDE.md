# Leksis — instructions for Claude

Leksis (leksis.eu) is a distributed, crowdsourced (althought initially populated with data from existing dictionaries via bots) omnilingual dictionary, thought for low-resource languages, built on the AT Protocol and ArangoDB.
The stack is based on aTurborepo monorepo: `apps/api` (Hono AppView), `apps/web` (React/Vite), `packages/types` (shared contract). The project is self-hosted on a VPS with Docker Compose, Caddy, and ArangoDB. The repo is continuously deployed to production on every tag (see .github/workflows/ci.yml).

## Orient first

- Load the **`leksis`** skill for architecture facts (stack, lexicon, ArangoDB schema) and the **`leksis-evolution`** skill for process (roadmap position, scope test, recording rules) before advising on any Leksis work. Never guess architecture facts.
- Project subagents in `.claude/agents/`: **scout** (find code), **planner** (design a milestone/feature plan), **reviewer** (pre-commit diff review with Leksis guardrails). All read-only. Delegate to them; keep implementation in the main session.


## Working method

The user works, sequentially, step by step and keeps control of what happens and when.

**Master is continuously deployable; tags mark finished features** (policy since 2026-08-14). Every commit must leave master deployable on its own, but a `v*` tag is created only at the **final slice of a feature**, never merely because a commit is deployable. Every tag deploys to production, so before proposing one, the pre-tag gate must have passed: a **testset pass** (the `leksis-testset` skill run as the feature's dedicated verification slice) and a successful local **`docker compose build`** (the image build is the deploy's real build — `npm run build` alone has missed production build breaks twice). See evolution skill step 3.

1. **Orient** — establish where the project stands (evolution skill step 1).
2. **Propose** — before any non-trivial change, state what you intend to change, in which files, and why. Wait for confirmation on anything beyond the agreed step.
3. **Implement the smallest slice** — one step at a time; each step leaves the repo typechecking and deployable. No "while I was here" additions: unplanned work is proposed, not slipped in.
4. **Verify** — per `.claude/skills/verify/SKILL.md`. A change is done when the affected flow has been exercised and proof shown, not when it compiles. You can also use the **leksis-testset** skill to run the testset on the affected flow.
5. **Record** — match the change to its home (CHANGELOG / ADR / skill update) per evolution skill step 4.


## Logging in during browser tests (the session wall — solved 2026-08-14)

Every surface except the landing page sits behind a login, and an agent must never type a
password into a form. The standing solution is a **dev-only scripted session**:
`apps/web/src/auth/dev-session.ts` logs the app in as `testaccount.leksis.eu` on load via
`com.atproto.server.createSession` (an `AtpAgent`, which `SessionProvider` accepts because
`AtpAgent extends Agent`), using the three `VITE_DEV_*` vars in the gitignored
`apps/web/.env.local`. The path is compiled out of production builds (`import.meta.env.DEV`)
and is a no-op when any var is blank. So: start the `web` preview, open `http://127.0.0.1:5173/`,
and the app is already connected — no manual login, ever. If it lands on the login form instead,
`.env.local` is missing/blank (the password line must be filled by the user by hand, once) or the
dev server predates the file (Vite restarts on .env changes; restart it if in doubt). Writes made
through this session are real records on the test account's PDS — that is the point, but never
publish outside the fixture rules in `leksis-testset`.

## Verification rules

- A PostToolUse hook (`.claude/hooks/verify-edit.sh`) typechecks and lints the touched workspace after every edit. Fix its feedback immediately — do not accumulate errors.
- Changes to `packages/types` require the full `npm run typecheck` (all workspaces).
- UI changes are verified in the browser preview (server `web`, port 5173); API changes by curling the affected endpoint with ArangoDB running. See the verify skill.

## Hard stops — never without explicit user approval

- `git commit`, `git push`, and above all **`git tag` / `git push --tags`**: pushing a tag triggers the GitHub Actions deploy to the production VPS. Treat tagging as a production deploy, because it is one.
- Deleting or migrating data in ArangoDB (superseded versions are archived with `current: false`; the only sanctioned removal is an `entries` version whose record was deleted from its author's PDS — see the reviewer agent's guardrails).
- Editing production/infra files: `docker-compose.yml`, `Caddyfile`, `.github/workflows`.
