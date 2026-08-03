import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const resolveStyloCredentialPath = () =>
  process.env.STYLO_CREDENTIAL_FILE || path.join(os.tmpdir(), `stylo-codex-${process.getuid?.() ?? "user"}.json`);

export const loadStyloCredential = async () => {
  const filePath = resolveStyloCredentialPath();
  try {
    const payload = JSON.parse(await readFile(filePath, "utf8"));
    const accessToken = typeof payload?.accessToken === "string" ? payload.accessToken.trim() : "";
    const expiresAt = Number(payload?.expiresAt) || 0;
    const apiBaseUrl = typeof payload?.apiBaseUrl === "string" ? payload.apiBaseUrl : "";
    if (!accessToken || expiresAt <= Date.now()) return null;
    return { accessToken, expiresAt, apiBaseUrl, filePath };
  } catch {
    return null;
  }
};

export const saveStyloCredential = async ({ accessToken, expiresAt, apiBaseUrl }) => {
  const filePath = resolveStyloCredentialPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify({ accessToken, expiresAt, apiBaseUrl })}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, filePath);
  await chmod(filePath, 0o600);
  return filePath;
};

export const removeStyloCredential = async () => {
  await rm(resolveStyloCredentialPath(), { force: true });
};

