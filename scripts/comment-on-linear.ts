import { commentOnIssue } from "./linear.ts";

const [issueId, ...rest] = process.argv.slice(2);
const body = rest.join(" ");
if (!issueId || !body) {
  console.error("Usage: comment-on-linear <issueId> <body...>");
  process.exit(2);
}

const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey) {
  console.error("Missing LINEAR_API_KEY");
  process.exit(2);
}

await commentOnIssue({ apiKey, issueId, body });
console.log("Comment posted.");
