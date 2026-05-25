/**
 * Dumps the parts of AppSignal's GraphQL schema we care about, so we can
 * fix appsignal.ts against the real types instead of guessing.
 *
 * Run from a consumer repo (auto-loads PROD__* from env) or with the canonical
 * APPSIGNAL_PERSONAL_TOKEN already set:
 *
 *   APPSIGNAL_PERSONAL_TOKEN=... npx tsx scripts/introspect-appsignal.ts
 */
import { GraphQLClient, gql } from "graphql-request";

const token =
  process.env.APPSIGNAL_PERSONAL_TOKEN ?? process.env.PROD__APPSIGNAL_PERSONAL_TOKEN;
if (!token) {
  console.error("Missing APPSIGNAL_PERSONAL_TOKEN");
  process.exit(2);
}

const client = new GraphQLClient(
  `https://appsignal.com/graphql?token=${encodeURIComponent(token)}`
);

type Field = {
  name: string;
  args?: { name: string; type: TypeRef }[];
  type?: TypeRef;
};
type TypeRef = { name: string | null; kind: string; ofType?: TypeRef | null };
type EnumValue = { name: string };

const introspectType = gql`
  query Introspect($name: String!) {
    __type(name: $name) {
      name
      kind
      enumValues {
        name
      }
      fields(includeDeprecated: true) {
        name
        type {
          name
          kind
          ofType {
            name
            kind
            ofType {
              name
              kind
            }
          }
        }
        args {
          name
          type {
            name
            kind
            ofType {
              name
              kind
              ofType {
                name
                kind
              }
            }
          }
        }
      }
    }
  }
`;

function typeName(t: TypeRef | null | undefined): string {
  if (!t) return "?";
  if (t.name) return t.kind === "NON_NULL" ? `${t.name}!` : t.name;
  if (t.ofType) {
    const inner = typeName(t.ofType);
    if (t.kind === "NON_NULL") return `${inner}!`;
    if (t.kind === "LIST") return `[${inner}]`;
    return inner;
  }
  return `<${t.kind}>`;
}

async function dump(name: string) {
  console.log(`\n=== ${name} ===`);
  try {
    const { __type: t } = await client.request<{
      __type: {
        name: string;
        kind: string;
        enumValues?: EnumValue[];
        fields?: Field[];
      } | null;
    }>(introspectType, { name });
    if (!t) {
      console.log("  (type not in schema)");
      return;
    }
    console.log(`  kind: ${t.kind}`);
    if (t.enumValues?.length) {
      console.log(`  values: ${t.enumValues.map((v) => v.name).join(", ")}`);
    }
    if (t.fields?.length) {
      for (const f of t.fields) {
        const args = f.args?.length
          ? `(${f.args.map((a) => `${a.name}: ${typeName(a.type)}`).join(", ")})`
          : "";
        console.log(`  ${f.name}${args} → ${typeName(f.type)}`);
      }
    }
  } catch (e) {
    console.error(`  error: ${(e as Error).message.split("\n")[0]}`);
  }
}

async function main() {
  // Schema fragments we need to write list + samples queries correctly.
  await dump("ExceptionIncident");
  await dump("ExceptionSample");
  await dump("IncidentOrderEnum");
  await dump("IncidentStateEnum");
  await dump("ExceptionIncidentQueryEnum");
  await dump("App");
}

main();
