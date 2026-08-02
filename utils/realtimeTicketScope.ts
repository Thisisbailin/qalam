const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const VISIT_SESSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$/;

const hasOnlyKeys = (params: URLSearchParams, allowed: Set<string>) => {
  for (const key of params.keys()) {
    if (!allowed.has(key)) return false;
  }
  return true;
};

/**
 * Produces the exact connection scope stored in a one-time realtime ticket.
 * Unknown routes, duplicate parameters and extra query data fail closed so a
 * ticket minted for one channel cannot be replayed against another channel.
 */
export const normalizeRealtimeTicketScope = (value: unknown) => {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 1_024) return "";
  let url: URL;
  try {
    url = new URL(value, "https://stylo.invalid");
  } catch {
    return "";
  }
  const duplicateKey = Array.from(new Set(url.searchParams.keys()))
    .some((key) => url.searchParams.getAll(key).length !== 1);
  if (duplicateKey || url.hash) return "";

  if (url.pathname === "/api/account-projects-realtime") {
    return url.search ? "" : url.pathname;
  }
  if (url.pathname === "/api/project-realtime") {
    if (!hasOnlyKeys(url.searchParams, new Set(["projectId"]))) return "";
    const projectId = (url.searchParams.get("projectId") || "").trim();
    if (!PROJECT_ID_PATTERN.test(projectId)) return "";
    return `${url.pathname}?projectId=${encodeURIComponent(projectId)}`;
  }
  if (url.pathname === "/api/public-project-realtime") {
    if (!hasOnlyKeys(url.searchParams, new Set(["username", "projectId", "visitSession"]))) return "";
    const username = (url.searchParams.get("username") || "").trim().toLowerCase();
    const projectId = (url.searchParams.get("projectId") || "").trim();
    const visitSession = (url.searchParams.get("visitSession") || "").trim();
    if (
      !USERNAME_PATTERN.test(username)
      || !PROJECT_ID_PATTERN.test(projectId)
      || !VISIT_SESSION_PATTERN.test(visitSession)
    ) return "";
    return `${url.pathname}?username=${encodeURIComponent(username)}`
      + `&projectId=${encodeURIComponent(projectId)}`
      + `&visitSession=${encodeURIComponent(visitSession)}`;
  }
  return "";
};
