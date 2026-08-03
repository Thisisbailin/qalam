#!/usr/bin/env node

import { spawn } from "node:child_process";
import os from "node:os";
import { saveStyloCredential } from "./stylo-credential-store.mjs";

const apiBaseUrl = (process.env.STYLO_API_BASE_URL || "https://node-qalam.pages.dev").replace(/\/+$/, "");
const shouldOpen = !process.argv.includes("--no-open");

const request = async (body) => {
  const response = await fetch(`${apiBaseUrl}/api/codex-pairing`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
};

const openStylo = (url) => {
  try {
    if (process.platform === "darwin") {
      spawn("open", ["-a", "Stylo"], { detached: true, stdio: "ignore" }).unref();
      return;
    }
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
      return;
    }
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // The printed code remains a complete manual fallback.
  }
};

const started = await request({ action: "start" });
if (!started.response.ok) {
  throw new Error(started.payload?.error || `Could not start Stylo pairing (HTTP ${started.response.status})`);
}

const { deviceCode, userCode, verificationUrl, expiresAt, intervalSeconds } = started.payload;
if (!deviceCode || !userCode || !verificationUrl || !expiresAt) {
  throw new Error("Stylo returned an incomplete pairing response.");
}

console.log(`Stylo pairing code: ${userCode}`);
console.log("In the signed-in Stylo desktop app, open Account → Connect Codex and enter this code.");
if (shouldOpen) openStylo(verificationUrl);

const intervalMs = Math.max(1_500, Math.min(5_000, Number(intervalSeconds || 2) * 1_000));
let connected = null;
while (Date.now() < Number(expiresAt)) {
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
  const polled = await request({
    action: "poll",
    deviceCode,
    label: `${os.hostname()} · Codex local MCP`,
  });
  if (polled.response.status === 202) continue;
  if (!polled.response.ok) {
    throw new Error(polled.payload?.error || `Stylo pairing failed (HTTP ${polled.response.status})`);
  }
  connected = polled.payload;
  break;
}

if (!connected?.accessToken || !connected?.expiresAt) {
  throw new Error("Stylo pairing expired before it was approved.");
}
const credentialPath = await saveStyloCredential({
  accessToken: connected.accessToken,
  expiresAt: Number(connected.expiresAt),
  apiBaseUrl,
});
console.log(`Stylo connected until ${new Date(Number(connected.expiresAt)).toLocaleString()}.`);
console.log(`Credential stored in the system temporary directory: ${credentialPath}`);
