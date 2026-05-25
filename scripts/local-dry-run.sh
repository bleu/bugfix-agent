#!/usr/bin/env bash
# Local dry-run of the bugfix-agent loop, with no GitHub Actions, no Docker,
# no Linear writes, no PR open. Just: pick a real AppSignal incident, render
# the agent prompt, hand it to you to run through Claude Code.
#
# Run from the CONSUMER repo (the one with .secrets + .github/agent/config.yml):
#
#   /path/to/bugfix-agent/scripts/local-dry-run.sh
#
# What it does:
#   1. Loads .secrets into env, mapping PROD__* names → canonical names.
#   2. Calls selector.ts (DRY_RUN=true → skips Linear dedup) to pick incident #1.
#   3. Calls prepare-run.ts --dry-run to render /tmp/prompt.md with the real
#      AppSignal samples but a fake Linear identifier.
#   4. Prints the next step (running Claude Code on the prompt) for you to do
#      manually so you control how aggressive the agent is.

set -uo pipefail

agent_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
consumer_dir="$PWD"
secrets_file="$consumer_dir/.secrets"
config_file="$consumer_dir/.github/agent/config.yml"

bold=$'\033[1m'; dim=$'\033[2m'; green=$'\033[32m'; red=$'\033[31m'; reset=$'\033[0m'

if [[ ! -f "$secrets_file" ]]; then
  echo "${red}✗${reset} no .secrets in $consumer_dir" >&2
  echo "  run this from the consumer repo root" >&2
  exit 2
fi
if [[ ! -f "$config_file" ]]; then
  echo "${red}✗${reset} no .github/agent/config.yml in $consumer_dir" >&2
  exit 2
fi
for cmd in jq node npx; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "${red}✗${reset} '$cmd' required" >&2; exit 2; }
done

# ---- Load .secrets ---------------------------------------------------------
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  line="${line#"${line%%[![:space:]]*}"}"
  [[ -z "$line" || "$line" == \#* ]] && continue
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    key="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
    if [[ ( "$val" == \"*\" || "$val" == \'*\' ) && ${#val} -ge 2 ]]; then
      val="${val:1:${#val}-2}"
    fi
    export "$key=$val"
  fi
done < "$secrets_file"

# Map consumer-specific names (e.g. perksocial's PROD__*) to canonical names
# that the scripts expect. Adjust here if your consumer uses different names.
: "${APPSIGNAL_APP_ID:=${PROD__APPSIGNAL_APP_ID:-}}"
: "${APPSIGNAL_PERSONAL_TOKEN:=${PROD__APPSIGNAL_PERSONAL_TOKEN:-}}"
export APPSIGNAL_APP_ID APPSIGNAL_PERSONAL_TOKEN
export DRY_RUN=true

if [[ -z "${APPSIGNAL_APP_ID:-}" || -z "${APPSIGNAL_PERSONAL_TOKEN:-}" ]]; then
  echo "${red}✗${reset} APPSIGNAL_APP_ID / APPSIGNAL_PERSONAL_TOKEN not set after loading .secrets" >&2
  echo "  check $secrets_file" >&2
  exit 2
fi

# ---- Install agent deps if needed ------------------------------------------
if [[ ! -d "$agent_dir/node_modules" ]]; then
  echo "${dim}→ installing bugfix-agent deps (one-time)...${reset}"
  (cd "$agent_dir" && npm install --silent --no-audit --no-fund) || {
    echo "${red}✗${reset} npm install failed" >&2; exit 1;
  }
fi

# ---- 1. Select top incident ------------------------------------------------
echo "${bold}→ selecting top AppSignal incident...${reset}"
if ! incidents=$(cd "$agent_dir" && npx -y tsx scripts/selector.ts "$config_file" 1 2>&1); then
  echo "${red}✗${reset} selector failed:" >&2
  echo "$incidents" >&2
  exit 1
fi

count=$(echo "$incidents" | jq 'length')
if [[ "$count" == "0" ]]; then
  echo "${red}✗${reset} no open incidents found in AppSignal" >&2
  exit 1
fi

echo "$incidents" | jq '.[0]' > /tmp/bugfix-agent-incident.json
incident_name=$(jq -r .name /tmp/bugfix-agent-incident.json)
incident_count=$(jq -r .count /tmp/bugfix-agent-incident.json)
incident_url=$(jq -r .url /tmp/bugfix-agent-incident.json)
echo "  picked: ${bold}$incident_name${reset}  ($incident_count occurrences)"
echo "  ${dim}$incident_url${reset}"
echo

# ---- 2. Render the prompt --------------------------------------------------
echo "${bold}→ rendering prompt...${reset}"
(cd "$agent_dir" && npx -y tsx scripts/prepare-run.ts \
  --incident /tmp/bugfix-agent-incident.json \
  --config "$config_file" \
  --trigger local-dry-run \
  --workspace "$consumer_dir" \
  --output /tmp/bugfix-agent-run-context.json \
  --dry-run) || { echo "${red}✗${reset} prepare-run failed" >&2; exit 1; }

prompt_lines=$(wc -l < /tmp/prompt.md | tr -d ' ')
prompt_bytes=$(wc -c < /tmp/prompt.md | tr -d ' ')
echo "  prompt: /tmp/prompt.md  ($prompt_lines lines, $prompt_bytes bytes)"
echo

# ---- 3. Next-step instructions --------------------------------------------
echo "${green}✓${reset} ready"
echo
echo "Review the prompt:"
echo "    ${dim}less /tmp/prompt.md${reset}"
echo
echo "Run Claude Code on it (from $consumer_dir):"
echo "    ${bold}claude -p \"\$(cat /tmp/prompt.md)\" --dangerously-skip-permissions${reset}"
echo
echo "  Or interactively, paste the prompt into a fresh \`claude\` session."
echo
echo "After Claude exits, inspect what it changed:"
echo "    ${dim}git -C $consumer_dir status --short${reset}"
echo "    ${dim}git -C $consumer_dir diff${reset}"
echo
echo "To reset the working tree when you're done:"
echo "    ${dim}git -C $consumer_dir checkout -- . && git -C $consumer_dir clean -fd${reset}"
