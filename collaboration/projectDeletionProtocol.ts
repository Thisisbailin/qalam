export type ProjectDeletionQueueMessage = {
  jobId: string;
  capability: string;
};

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const createProjectDeletionCapability = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
};

export const hashProjectDeletionCapability = async (capability: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(capability),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
};

export const normalizeProjectDeletionQueueMessage = (
  value: unknown,
): ProjectDeletionQueueMessage | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const jobId = typeof record.jobId === "string" ? record.jobId.trim() : "";
  const capability = typeof record.capability === "string" ? record.capability.trim() : "";
  return JOB_ID_PATTERN.test(jobId) && CAPABILITY_PATTERN.test(capability)
    ? { jobId, capability }
    : null;
};
