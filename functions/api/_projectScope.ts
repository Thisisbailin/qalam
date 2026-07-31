import { jsonResponse } from "./_auth";

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;

export const normalizeProjectId = (value: unknown) => {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return PROJECT_ID_PATTERN.test(normalized) ? normalized : "";
};

export const readRequestProjectId = (request: Request, body?: Record<string, unknown> | null) => {
  const urlValue = new URL(request.url).searchParams.get("projectId");
  return normalizeProjectId(urlValue || body?.projectId);
};

export const requireRequestProjectId = (request: Request, body?: Record<string, unknown> | null) => {
  const projectId = readRequestProjectId(request, body);
  if (projectId) return projectId;
  throw jsonResponse(
    { error: "A valid projectId is required", code: "PROJECT_SCOPE_REQUIRED" },
    { status: 400 },
  );
};
