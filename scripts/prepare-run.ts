/**
 * Used by fix-one.yml step "Resolve incident metadata".
 *
 * - Loads config + incident
 * - Ensures a Linear issue exists for the incident (creates if missing)
 * - Pulls AppSignal samples
 * - Renders prompts/fix-incident.md with substitutions
 * - Writes /tmp/prompt.md and JSON run-context to the path given by --output
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { ConfigSchema, IncidentSchema } from "./types.ts";
import { getIncidentSamples } from "./appsignal.ts";
import { createIssue, findIssueByFingerprint } from "./linear.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`Missing --${name}`);
  return process.argv[i + 1];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function main() {
  const incidentPath = arg("incident");
  const configPath = arg("config");
  const trigger = arg("trigger");
  const workspace = arg("workspace");
  const outputPath = arg("output");
  const dryRun = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";

  const incident = IncidentSchema.parse(JSON.parse(readFileSync(incidentPath, "utf8")));
  const config = ConfigSchema.parse(parseYaml(readFileSync(configPath, "utf8")));

  const appId = process.env.APPSIGNAL_APP_ID!;
  const token = process.env.APPSIGNAL_PERSONAL_TOKEN!;
  const linearKey = process.env.LINEAR_API_KEY ?? "";

  const samples = await getIncidentSamples({
    appId,
    token,
    incidentId: incident.id,
    limit: 3,
  });

  let issue: {
    id: string;
    identifier: string;
    url: string;
    title: string;
    state: { id: string; name: string; type: string };
    completedAt: string | null;
  } | null = null;

  if (dryRun) {
    issue = {
      id: "dryrun",
      identifier: `${config.linear.team_key}-DRYRUN`,
      url: "https://linear.app/(dry-run)",
      title: `(dry-run) ${incident.name}`,
      state: { id: "dry", name: "Backlog", type: "backlog" },
      completedAt: null,
    };
    console.error(`[dry-run] skipping Linear issue create/lookup`);
  } else {
    issue = await findIssueByFingerprint({
      apiKey: linearKey,
      teamKey: config.linear.team_key,
      incidentId: incident.id,
    });

    const teamId = config.linear.team_id;

    if (!issue) {
      const stackPreview =
        typeof samples[0] === "object" && samples[0] && "backtrace" in samples[0]
          ? String((samples[0] as { backtrace: unknown }).backtrace).slice(0, 4000)
          : "";
      issue = await createIssue({
        apiKey: linearKey,
        teamId,
        projectId: config.linear.project_id,
        stateId: config.linear.backlog_state_id,
        labelIds: [config.linear.agent_ready_label_id],
        title: `[bugfix-agent] ${incident.name}: ${incident.message ?? ""}`.slice(0, 200),
        incidentId: incident.id,
        incidentUrl: incident.url,
        occurrenceCount: incident.count,
        stackPreview,
        projectDescription: config.project_description,
      });
    }
  }

  const promptTemplate = readFileSync(join(REPO_ROOT, "prompts", "fix-incident.md"), "utf8");
  const contextList = config.context_files.map((f) => `- ${f}`).join("\n") || "- (none specified)";
  const ignoreList = config.ignore_paths.join(", ") || "(none)";

  const rendered = promptTemplate
    .replaceAll("{{PROJECT_NAME}}", config.project_name)
    .replaceAll("{{PROJECT_DESCRIPTION}}", config.project_description.trim())
    .replaceAll("{{CONTEXT_FILES_LIST}}", contextList)
    .replaceAll("{{LINEAR_IDENTIFIER}}", issue.identifier)
    .replaceAll("{{LINEAR_URL}}", issue.url)
    .replaceAll("{{INCIDENT_URL}}", incident.url)
    .replaceAll("{{INCIDENT_NAME}}", incident.name)
    .replaceAll("{{INCIDENT_MESSAGE}}", incident.message ?? "(none)")
    .replaceAll("{{ACTION_NAMES}}", incident.action_names.join(", ") || "(none)")
    .replaceAll("{{OCCURRENCE_COUNT}}", String(incident.count))
    .replaceAll("{{LAST_OCCURRED_AT}}", incident.last_occurred_at)
    .replaceAll("{{REVISION}}", incident.revision ?? "(unknown)")
    .replaceAll("{{SAMPLES_JSON}}", JSON.stringify(samples, null, 2).slice(0, 6000))
    .replaceAll("{{TEST_COMMAND}}", config.test_command)
    .replaceAll("{{BASE_BRANCH}}", config.base_branch)
    .replaceAll("{{IGNORE_PATHS}}", ignoreList);

  writeFileSync("/tmp/prompt.md", rendered, "utf8");

  const branch = `agent/${issue.identifier.toLowerCase()}-${slugify(incident.name)}`;

  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        linear_identifier: issue.identifier,
        linear_issue_id: issue.id,
        linear_url: issue.url,
        branch,
        trigger,
        workspace,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`Prepared run for ${issue.identifier} (incident ${incident.id})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
