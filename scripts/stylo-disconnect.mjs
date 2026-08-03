#!/usr/bin/env node

import {
  loadStyloCredential,
  removeStyloCredential,
} from "./stylo-credential-store.mjs";

const credential = await loadStyloCredential();
if (!credential) {
  await removeStyloCredential();
  console.log("Stylo is already disconnected.");
  process.exit(0);
}

const apiBaseUrl = (credential.apiBaseUrl || process.env.STYLO_API_BASE_URL || "https://node-qalam.pages.dev").replace(/\/+$/, "");
const response = await fetch(`${apiBaseUrl}/api/agent-access`, {
  method: "DELETE",
  headers: { authorization: `Bearer ${credential.accessToken}`, accept: "application/json" },
});
if (!response.ok && response.status !== 401) {
  const payload = await response.json().catch(() => ({}));
  throw new Error(payload?.error || `Could not revoke Stylo access (HTTP ${response.status})`);
}
await removeStyloCredential();
console.log("Stylo Codex access revoked and the local temporary credential removed.");

