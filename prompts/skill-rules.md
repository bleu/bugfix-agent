# Skill rules

Hard constraints layered on top of the per-incident prompt. These apply to every agent run regardless of project.

## DO

- Read `CLAUDE.md` and any `CONTEXT.md` files listed in the per-project config before touching code.
- Read the surrounding file before editing — match its conventions (naming, error handling, test style).
- Prefer the smallest possible change. If a single-line fix exists, that's the fix.
- Do NOT install dependencies (bundle install, npm/pnpm install, gem install). The runner is intentionally minimal — it has the source code only. CI will validate the fix after the PR is opened.
- Do NOT run tests, linters, type-checkers, or any project script. You can't; the dependencies aren't installed. Rely on CI.
- When inspecting prod data, query only via the read-only replica. Aggregate counts/shape only; never log PII to PR body or logs.
- Use conventional-commit prefixes (`fix:`, `refactor:`, `test:`). Imperative mood, lowercase after the type.
- Reference the Linear identifier in branch name + PR body. Put `Closes PRK-xxx` in the body for auto-link.

## DON'T

- Don't refactor unrelated code in the same PR.
- Don't introduce new dependencies unless strictly required by the fix.
- Don't add error-swallowing `rescue Exception` / `try { } catch { /* ignore */ }` to silence the symptom.
- Don't disable, `skip`, `xit`, or `xdescribe` existing tests — even though you won't run them, weakening them is still a regression.
- Don't try to `bundle install`, `npm install`, or any package install. The runner doesn't have these set up; CI does.
- Don't write `--no-verify`, `--no-gpg-sign`, or similar bypass flags.
- Don't push directly to base. Always open a PR.
- Don't add `Co-Authored-By: Claude` (or any AI coauthor) to commits or PR body.
- Don't add comments like "Fixes incident X" or "Used by Y". The PR description is the place for context.
- Don't modify infrastructure paths (terraform/cdk), e2e suites, or anything in the project's `ignore_paths`.
- Don't log secrets, tokens, DB URLs, or sample payloads containing PII.

## When to bail (open `AGENT_HANDOFF.md` instead of a PR)

- Root cause is genuinely ambiguous after diagnosis.
- The fix requires a product/UX decision (e.g., "should empty state show X or Y?").
- The fix touches more than ~10 files or crosses bounded contexts.
- The fix would require a DB schema migration.
- The fix would require changes to authentication, authorization, billing, or payments code.
- Tests pass locally only by removing/weakening assertions.

`AGENT_HANDOFF.md` format:

```markdown
# Handoff: {LINEAR_IDENTIFIER}

## Diagnosis
<what you observed, what you ruled out>

## Suspected root cause
<best hypothesis with evidence>

## Why I'm not fixing this autonomously
<one of the bail reasons above, concretely>

## Suggested next steps
<what a human should do next>
```
