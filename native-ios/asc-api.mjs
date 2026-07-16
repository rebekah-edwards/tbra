#!/usr/bin/env node
// App Store Connect API helper for tbr*a TestFlight ops.
// Auth: Team key ~/.appstoreconnect/private_keys/AuthKey_38YZTL6X8H.p8 (Admin).
// Usage:
//   node asc-api.mjs apps
//   node asc-api.mjs builds
//   node asc-api.mjs get <path>            e.g. get /v1/apps/<id>/betaGroups
//   node asc-api.mjs req <METHOD> <path> '<json>'
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SignJWT, importPKCS8 } from "jose";

const KEY_ID = "38YZTL6X8H";
const ISSUER_ID = "2c70c044-4df1-4b89-a56a-9a948b1a653b";
const BASE = "https://api.appstoreconnect.apple.com";

async function token() {
  const pem = readFileSync(join(homedir(), ".appstoreconnect/private_keys", `AuthKey_${KEY_ID}.p8`), "utf8");
  const key = await importPKCS8(pem, "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: KEY_ID, typ: "JWT" })
    .setIssuer(ISSUER_ID)
    .setIssuedAt()
    .setExpirationTime("15m")
    .setAudience("appstoreconnect-v1")
    .sign(key);
}

export async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json.errors ?? json).slice(0, 800)}`);
  return json;
}

const [, , cmd, ...args] = process.argv;
if (cmd === "apps") {
  const r = await req("GET", "/v1/apps?fields[apps]=name,bundleId,sku");
  console.log(JSON.stringify(r.data?.map(a => ({ id: a.id, ...a.attributes })), null, 2));
} else if (cmd === "builds") {
  const r = await req("GET", "/v1/builds?limit=10&sort=-uploadedDate&fields[builds]=version,processingState,uploadedDate,expired");
  console.log(JSON.stringify(r.data?.map(b => ({ id: b.id, ...b.attributes })), null, 2));
} else if (cmd === "get") {
  console.log(JSON.stringify(await req("GET", args[0]), null, 2));
} else if (cmd === "req") {
  console.log(JSON.stringify(await req(args[0], args[1], args[2] ? JSON.parse(args[2]) : undefined), null, 2));
} else if (cmd) {
  console.error("unknown command");
  process.exit(1);
}
