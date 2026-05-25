import { z } from "zod";

export const IncidentSchema = z.object({
  id: z.string(),
  number: z.number(),
  name: z.string(),
  message: z.string().nullable(),
  action_names: z.array(z.string()).default([]),
  count: z.number(),
  last_occurred_at: z.string(),
  first_seen_at: z.string(),
  revision: z.string().nullable().optional(),
  state: z.enum(["open", "closed", "ignored"]),
  url: z.string(),
});
export type Incident = z.infer<typeof IncidentSchema>;

export const ConfigSchema = z.object({
  project_name: z.string(),
  project_description: z.string(),
  max_fixes_per_day: z.number().int().positive().default(5),
  severity_threshold: z.enum(["warning", "error", "fatal"]).default("error"),
  ignore_paths: z.array(z.string()).default([]),
  context_files: z.array(z.string()).default([]),
  linear: z.object({
    team_id: z.string(),
    team_key: z.string(),
    project_id: z.string(),
    agent_ready_label_id: z.string(),
    backlog_state_id: z.string().optional(),
  }),
  test_command: z.string().default("bin/rails test"),
  base_branch: z.string().default("main"),
});
export type Config = z.infer<typeof ConfigSchema>;

export const FINGERPRINT_PREFIX = "appsignal-incident:";
export const fingerprint = (incidentId: string) => `${FINGERPRINT_PREFIX}${incidentId}`;
