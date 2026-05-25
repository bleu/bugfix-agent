# bugfix-agent

Cross-repo autonomous bug-fix agent for the [bleu](https://github.com/bleu) org. Lives as reusable GitHub Actions workflows + Claude Code prompts. Any repo (in any org) can plug in by adding a thin wrapper workflow + a `config.yml` and mapping their secrets.

## What it does

- **Daily cron** picks the top-N highest-impact AppSignal incidents and opens fix PRs.
- **Post-deploy watch** monitors AppSignal for 30 min after each deploy and fixes the first new incident it sees.
- **Linear is the source of truth** for "already attempted" — each AppSignal incident maps to one Linear issue, keyed by `appsignal-incident:<id>` in the issue description.

## Architecture

```
bleu/bugfix-agent (this repo)
├─ .github/workflows/
│  ├─ daily.yml      # workflow_call: cron entrypoint (top-N selection)
│  ├─ watch.yml      # workflow_call: post-deploy poll
│  └─ fix-one.yml    # workflow_call: fix one incident (shared inner)
├─ scripts/
│  ├─ appsignal.ts   # AppSignal GraphQL client
│  ├─ linear.ts      # Linear GraphQL client
│  ├─ selector.ts    # picks top-N minus Linear-known
│  ├─ prepare-run.ts # ensures Linear issue + renders prompt
│  └─ watch-poll.sh  # 30-min poll loop
└─ prompts/
   ├─ fix-incident.md
   └─ skill-rules.md
```

## Cross-org visibility

This repo must be reachable by every consuming repo. Options:

| If consumers live in… | Make `bleu/bugfix-agent` |
| --- | --- |
| Same `bleu` org | **internal** (cheapest) or **public** |
| Different org (e.g. `perk-studio`) | **public**, or **internal** under a shared enterprise with Actions sharing allowed |

For the perksocial example below (org: `perk-studio`), this repo needs to be public unless both orgs sit under one GitHub enterprise that has Actions sharing turned on.

## Consumer onboarding

In your consumer repo, add four files (paths relative to repo root):

### 1. `.github/workflows/bugfix-daily.yml`

```yaml
name: bugfix-agent (daily)
on:
  schedule: [{cron: '0 13 * * 1-5'}]
  workflow_dispatch:
jobs:
  fix:
    uses: bleu/bugfix-agent/.github/workflows/daily.yml@v1
    with:
      max_fixes: 5
      base_branch: main           # whatever your default PR base is
      config_path: .github/agent/config.yml
    secrets:
      ANTHROPIC_API_KEY:         ${{ secrets.ANTHROPIC_API_KEY }}
      LINEAR_API_KEY:            ${{ secrets.LINEAR_API_KEY }}
      APPSIGNAL_APP_ID:          ${{ secrets.APPSIGNAL_APP_ID }}
      APPSIGNAL_PERSONAL_TOKEN:  ${{ secrets.APPSIGNAL_PERSONAL_TOKEN }}
      DATABASE_READONLY_URL:     ${{ secrets.DATABASE_READONLY_URL }}
      TS_OAUTH_CLIENT_ID:        ${{ secrets.TS_OAUTH_CLIENT_ID }}
      TS_OAUTH_SECRET:           ${{ secrets.TS_OAUTH_SECRET }}
```

If your repo uses a different secret naming convention (e.g., `PROD__APPSIGNAL_APP_ID`), map them here — the agent only ever sees the canonical names on the right side.

### 2. `.github/workflows/bugfix-watch.yml`

```yaml
name: bugfix-agent (post-deploy watch)
on:
  workflow_dispatch:
    inputs:
      deploy_sha:  { required: true, type: string }
      deploy_time: { required: true, type: string }   # ISO8601
jobs:
  watch:
    uses: bleu/bugfix-agent/.github/workflows/watch.yml@v1
    with:
      deploy_sha:   ${{ inputs.deploy_sha }}
      deploy_time:  ${{ inputs.deploy_time }}
      window_minutes: 30
      base_branch: main
      config_path: .github/agent/config.yml
    secrets:
      # …same mapping as bugfix-daily.yml…
```

### 3. `.github/agent/config.yml`

```yaml
project_name: my-project
project_description: |
  One paragraph telling the agent what this project is, who uses it,
  and what its bounded contexts look like.

max_fixes_per_day: 5
severity_threshold: error
ignore_paths:
  - infra/**
  - e2e/**

context_files:
  - CLAUDE.md
  - docs/**.md

linear:
  team_id: <uuid>                                  # required
  team_key: TEAM                                   # required (issue prefix, e.g. PRK)
  project_id: <uuid>                               # required
  agent_ready_label_id: <uuid>                     # required
  backlog_state_id: <uuid>                         # optional

test_command: bin/rails test
base_branch: main
```

### 4. Repo secrets

Required: `ANTHROPIC_API_KEY`, `LINEAR_API_KEY`, `APPSIGNAL_APP_ID`, `APPSIGNAL_PERSONAL_TOKEN`.
Optional: `DATABASE_READONLY_URL`, `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` (only if your DB lives behind Tailscale).

### 5. (Optional) Wire the post-deploy hook

Have your deploy pipeline fire:

```bash
gh workflow run bugfix-watch.yml \
  -R <org>/<repo> \
  -f deploy_sha=<sha> \
  -f deploy_time=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

## Versioning

Pin consumers to `@v1`. Major-version tags only move forward on breaking input/secret changes. Minor bug-fixes go in place on the same tag.

## Linear ↔ GitHub PR auto-link

The agent injects the Linear identifier (`PRK-123`) into the branch name and the PR body. Linear's native GitHub integration auto-attaches the PR if the integration is enabled in Linear settings.
