import { GraphQLClient, gql } from "graphql-request";
import { FINGERPRINT_PREFIX, fingerprint } from "./types.ts";

const LINEAR_GQL = "https://api.linear.app/graphql";

function client(apiKey: string) {
  return new GraphQLClient(LINEAR_GQL, { headers: { Authorization: apiKey } });
}

const SEARCH_BY_FINGERPRINT = gql`
  query SearchByFingerprint($filter: IssueFilter!) {
    issues(filter: $filter, first: 5) {
      nodes {
        id
        identifier
        title
        state {
          id
          name
          type
        }
        completedAt
        url
      }
    }
  }
`;

const CREATE_ISSUE = gql`
  mutation CreateIssue($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        id
        identifier
        url
      }
    }
  }
`;

const ADD_LABEL = gql`
  mutation IssueAddLabel($id: String!, $labelIds: [String!]!) {
    issueUpdate(id: $id, input: { labelIds: $labelIds }) {
      success
    }
  }
`;

const COMMENT_ON_ISSUE = gql`
  mutation CommentCreate($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
    }
  }
`;

export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  state: { id: string; name: string; type: string };
  completedAt: string | null;
  url: string;
};

export async function findIssueByFingerprint(opts: {
  apiKey: string;
  teamKey: string;
  incidentId: string;
}): Promise<LinearIssue | null> {
  const fp = fingerprint(opts.incidentId);
  const data = await client(opts.apiKey).request<{ issues: { nodes: LinearIssue[] } }>(
    SEARCH_BY_FINGERPRINT,
    {
      filter: {
        team: { key: { eq: opts.teamKey } },
        description: { contains: fp },
      },
    }
  );
  return data.issues.nodes[0] ?? null;
}

export async function createIssue(opts: {
  apiKey: string;
  teamId: string;
  projectId: string;
  stateId?: string;
  labelIds: string[];
  title: string;
  incidentId: string;
  incidentUrl: string;
  occurrenceCount: number;
  stackPreview: string;
  projectDescription: string;
}): Promise<LinearIssue> {
  const description = [
    `**${FINGERPRINT_PREFIX}${opts.incidentId}**`,
    "",
    `Auto-filed by bugfix-agent.`,
    "",
    `- AppSignal incident: ${opts.incidentUrl}`,
    `- Occurrences: ${opts.occurrenceCount}`,
    "",
    "### Stack preview",
    "```",
    opts.stackPreview.slice(0, 4000),
    "```",
    "",
    "### Project context",
    opts.projectDescription,
  ].join("\n");

  const data = await client(opts.apiKey).request<{
    issueCreate: { success: boolean; issue: LinearIssue };
  }>(CREATE_ISSUE, {
    input: {
      teamId: opts.teamId,
      projectId: opts.projectId,
      stateId: opts.stateId,
      labelIds: opts.labelIds,
      title: opts.title,
      description,
    },
  });

  if (!data.issueCreate.success) throw new Error("Linear issueCreate failed");
  return data.issueCreate.issue;
}

export async function removeAgentReadyLabel(opts: {
  apiKey: string;
  issueId: string;
  remainingLabelIds: string[];
}) {
  await client(opts.apiKey).request(ADD_LABEL, {
    id: opts.issueId,
    labelIds: opts.remainingLabelIds,
  });
}

export async function commentOnIssue(opts: { apiKey: string; issueId: string; body: string }) {
  await client(opts.apiKey).request(COMMENT_ON_ISSUE, {
    input: { issueId: opts.issueId, body: opts.body },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const apiKey = process.env.LINEAR_API_KEY!;
  if (!apiKey) {
    console.error("Missing LINEAR_API_KEY");
    process.exit(2);
  }
  const cmd = process.argv[2];
  if (cmd === "find") {
    findIssueByFingerprint({
      apiKey,
      teamKey: process.argv[3],
      incidentId: process.argv[4],
    }).then((r) => console.log(JSON.stringify(r, null, 2)));
  } else {
    console.error("Usage: linear find <teamKey> <incidentId>");
    process.exit(2);
  }
}
