import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { ConfigSchema, type Config, type Incident } from "./types.ts";
import { listTopIncidents } from "./appsignal.ts";
import { findIssueByFingerprint } from "./linear.ts";

const STALE_DAYS = 14;
const RAW_LIMIT = 50;

function loadConfig(path: string): Config {
  const raw = readFileSync(path, "utf8");
  return ConfigSchema.parse(parseYaml(raw));
}

function secret(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing secret env: ${name}`);
  return v;
}

function isStale(completedAt: string | null): boolean {
  if (!completedAt) return false;
  const ageMs = Date.now() - new Date(completedAt).getTime();
  return ageMs > STALE_DAYS * 86_400_000;
}

export async function pickIncidents(configPath: string, maxFixes: number): Promise<Incident[]> {
  const config = loadConfig(configPath);
  const appId = secret("APPSIGNAL_APP_ID");
  const token = secret("APPSIGNAL_PERSONAL_TOKEN");
  const linearKey = secret("LINEAR_API_KEY");

  const candidates = await listTopIncidents({ appId, token, limit: RAW_LIMIT });
  const picked: Incident[] = [];

  for (const incident of candidates) {
    if (picked.length >= maxFixes) break;
    const existing = await findIssueByFingerprint({
      apiKey: linearKey,
      teamKey: config.linear.team_key,
      incidentId: incident.id,
    });
    if (existing) {
      const done = existing.state.type === "completed" || existing.state.type === "canceled";
      if (!done || !isStale(existing.completedAt)) continue;
    }
    picked.push(incident);
  }
  return picked;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const configPath = process.argv[2];
  const max = Number(process.argv[3] ?? 5);
  pickIncidents(configPath, max).then((r) => {
    console.log(JSON.stringify(r, null, 2));
  });
}
