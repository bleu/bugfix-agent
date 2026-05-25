import { GraphQLClient, gql } from "graphql-request";
import { IncidentSchema, type Incident } from "./types.ts";

const APPSIGNAL_GQL = "https://appsignal.com/graphql";

function client(token: string) {
  // AppSignal authenticates via ?token=… on the URL (same scheme as their
  // REST API), not via an Authorization header.
  return new GraphQLClient(`${APPSIGNAL_GQL}?token=${encodeURIComponent(token)}`);
}

const LIST_QUERY = gql`
  query ListIncidents($appId: String!, $limit: Int!, $state: ExceptionIncidentStateEnum!) {
    app(id: $appId) {
      exceptionIncidents(state: $state, limit: $limit, order: LAST_OCCURRED) {
        id
        number
        name: exceptionName
        message: exceptionMessage
        actionNames
        count: occurrenceCount
        lastOccurredAt
        firstBacktraceAt
        revision: lastRevision
        state
      }
    }
  }
`;

const SAMPLES_QUERY = gql`
  query IncidentSamples($appId: String!, $incidentId: String!, $limit: Int!) {
    app(id: $appId) {
      exceptionIncident(id: $incidentId) {
        id
        samples(limit: $limit) {
          id
          time
          revision
          action: actionName
          namespace
          backtrace
          params
          environment
          customData
        }
      }
    }
  }
`;

type RawIncident = {
  id: string;
  number: number;
  name: string;
  message: string | null;
  actionNames: string[];
  count: number;
  lastOccurredAt: string;
  firstBacktraceAt: string;
  revision: string | null;
  state: "OPEN" | "CLOSED" | "IGNORED";
};

const orgSlug = (appId: string) => process.env.APPSIGNAL_ORG_SLUG ?? "perk-studio";

const incidentUrl = (appId: string, number: number) =>
  `https://appsignal.com/${orgSlug(appId)}/sites/${appId}/exceptions/${number}`;

export async function listTopIncidents(opts: {
  appId: string;
  token: string;
  limit: number;
}): Promise<Incident[]> {
  const data = await client(opts.token).request<{
    app: { exceptionIncidents: RawIncident[] };
  }>(LIST_QUERY, { appId: opts.appId, limit: opts.limit, state: "OPEN" });

  return data.app.exceptionIncidents
    .map((i) =>
      IncidentSchema.parse({
        id: i.id,
        number: i.number,
        name: i.name,
        message: i.message,
        action_names: i.actionNames ?? [],
        count: i.count,
        last_occurred_at: i.lastOccurredAt,
        first_seen_at: i.firstBacktraceAt,
        revision: i.revision,
        state: i.state.toLowerCase(),
        url: incidentUrl(opts.appId, i.number),
      })
    )
    .sort((a, b) => b.count - a.count);
}

export async function getIncidentSamples(opts: {
  appId: string;
  token: string;
  incidentId: string;
  limit?: number;
}) {
  const data = await client(opts.token).request<{
    app: { exceptionIncident: { samples: unknown[] } };
  }>(SAMPLES_QUERY, {
    appId: opts.appId,
    incidentId: opts.incidentId,
    limit: opts.limit ?? 3,
  });
  return data.app.exceptionIncident.samples;
}

export async function listIncidentsSince(opts: {
  appId: string;
  token: string;
  sinceISO: string;
  revision?: string;
}): Promise<Incident[]> {
  const all = await listTopIncidents({ appId: opts.appId, token: opts.token, limit: 100 });
  const since = new Date(opts.sinceISO).getTime();
  return all.filter((i) => {
    if (new Date(i.first_seen_at).getTime() < since) return false;
    if (opts.revision && i.revision && i.revision !== opts.revision) return false;
    return true;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  const appId = process.env.APPSIGNAL_APP_ID!;
  const token = process.env.APPSIGNAL_PERSONAL_TOKEN!;
  if (!appId || !token) {
    console.error("Missing APPSIGNAL_APP_ID or APPSIGNAL_PERSONAL_TOKEN");
    process.exit(2);
  }
  if (cmd === "top") {
    const limit = Number(process.argv[3] ?? 10);
    listTopIncidents({ appId, token, limit }).then((r) => console.log(JSON.stringify(r, null, 2)));
  } else if (cmd === "samples") {
    const incidentId = process.argv[3];
    getIncidentSamples({ appId, token, incidentId }).then((r) =>
      console.log(JSON.stringify(r, null, 2))
    );
  } else if (cmd === "since") {
    listIncidentsSince({ appId, token, sinceISO: process.argv[3], revision: process.argv[4] }).then(
      (r) => console.log(JSON.stringify(r, null, 2))
    );
  } else {
    console.error("Usage: appsignal <top N | samples <id> | since <ISO> [revision]>");
    process.exit(2);
  }
}
