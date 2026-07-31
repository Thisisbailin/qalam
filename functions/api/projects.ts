import { getUserId, jsonResponse } from "./_auth";
import { ACCOUNT_PROJECT_LIMIT } from "./_projectCatalog";
import type { D1DatabaseLike } from "./_types";
import {
  notifyAccountProjectCatalogChanged,
  type AccountRealtimeEnv,
} from "./_accountRealtime";

type Env = AccountRealtimeEnv & {
  DB: D1DatabaseLike;
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
};

const MAX_PROJECTS = ACCOUNT_PROJECT_LIMIT;
const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;

type CatalogInput = {
  projectId?: unknown;
  title?: unknown;
  color?: unknown;
  durationMin?: unknown;
  rootNodeId?: unknown;
  createdAt?: unknown;
};

const normalizeText = (value: unknown, fallback: string, max: number) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : fallback;

const normalizeCatalogInput = (value: unknown) => {
  if (!value || typeof value !== "object") return null;
  const input = value as CatalogInput;
  const projectId = typeof input.projectId === "string" ? input.projectId.trim() : "";
  if (!PROJECT_ID_PATTERN.test(projectId)) return null;
  const duration = Number(input.durationMin);
  const createdAt = Number(input.createdAt);
  return {
    projectId,
    title: normalizeText(input.title, projectId, 200),
    color: normalizeText(input.color, "amber", 32),
    durationMin: Number.isFinite(duration) ? Math.max(1, Math.min(1440, Math.round(duration))) : 120,
    rootNodeId: normalizeText(input.rootNodeId, `project-root-${projectId}`, 240),
    createdAt: Number.isSafeInteger(createdAt) && createdAt > 0 ? createdAt : Date.now(),
  };
};

export const onRequestGet = async (context: { request: Request; env: Env }) => {
  try {
    const userId = await getUserId(context.request, context.env);
    const rows = await context.env.DB.prepare(
      `SELECT c.project_id, c.title, c.color, c.duration_min,
              c.root_node_id, c.created_at, c.updated_at,
              CASE WHEN d.project_id IS NULL THEN 0 ELSE 1 END AS has_document
       FROM user_project_catalog c
       LEFT JOIN user_project_documents d
         ON d.user_id = c.user_id AND d.project_id = c.project_id
       WHERE c.user_id = ?1
       ORDER BY c.updated_at DESC, c.project_id ASC
       LIMIT 100`,
    ).bind(userId).all();
    const deletionRows = await context.env.DB.prepare(
      `SELECT project_id FROM user_project_deletions
       WHERE user_id = ?1
       ORDER BY deleted_at DESC
       LIMIT 200`,
    ).bind(userId).all();
    return jsonResponse({
      projects: (rows?.results || []).map((row: Record<string, unknown>) => ({
        projectId: String(row.project_id || ""),
        title: String(row.title || row.project_id || ""),
        color: String(row.color || "amber"),
        durationMin: Number(row.duration_min) || 120,
        rootNodeId: String(row.root_node_id || `project-root-${row.project_id || ""}`),
        createdAt: Number(row.created_at) || 0,
        updatedAt: Number(row.updated_at) || 0,
        hasDocument: Number(row.has_document) === 1,
      })).filter((item: { projectId: string }) => Boolean(item.projectId)),
      deletedProjectIds: (deletionRows?.results || [])
        .map((row: Record<string, unknown>) => String(row.project_id || ""))
        .filter(Boolean),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("GET /api/projects error", error);
    return jsonResponse({ error: "Failed to list cloud projects" }, { status: 500 });
  }
};

export const onRequestPut = async (context: { request: Request; env: Env }) => {
  try {
    const userId = await getUserId(context.request, context.env);
    const body = await context.request.json().catch(() => null) as { projects?: unknown } | null;
    if (!body || !Array.isArray(body.projects) || body.projects.length > MAX_PROJECTS) {
      return jsonResponse({ error: "Invalid project catalog" }, { status: 400 });
    }
    const projects = body.projects.map(normalizeCatalogInput);
    if (projects.some((project) => !project)) {
      return jsonResponse({ error: "Invalid project catalog entry" }, { status: 400 });
    }
    const unique = new Set(projects.map((project) => project!.projectId));
    if (unique.size !== projects.length) {
      return jsonResponse({ error: "Duplicate project catalog entry" }, { status: 400 });
    }
    const deletionRows = await context.env.DB.prepare(
      "SELECT project_id FROM user_project_deletions WHERE user_id = ?1",
    ).bind(userId).all();
    const deletedProjectIds = new Set(
      (deletionRows?.results || [])
        .map((row: Record<string, unknown>) => String(row.project_id || ""))
        .filter(Boolean),
    );
    const existingRows = await context.env.DB.prepare(
      "SELECT project_id FROM user_project_catalog WHERE user_id = ?1",
    ).bind(userId).all();
    const existingProjectIds = new Set(
      (existingRows?.results || [])
        .map((row: Record<string, unknown>) => String(row.project_id || ""))
        .filter(Boolean),
    );
    const requestedNewProjectIds = projects
      .map((project) => project!.projectId)
      .filter((projectId) =>
        !existingProjectIds.has(projectId) && !deletedProjectIds.has(projectId)
      );
    if (existingProjectIds.size + requestedNewProjectIds.length > MAX_PROJECTS) {
      return jsonResponse({
        error: `An account can contain at most ${MAX_PROJECTS} projects`,
        code: "PROJECT_LIMIT_REACHED",
      }, { status: 409 });
    }
    const acceptedProjects = projects.filter((project) => !deletedProjectIds.has(project!.projectId));
    const now = Date.now();
    if (acceptedProjects.length) {
      await context.env.DB.batch(acceptedProjects.map((project) => context.env.DB.prepare(
        `INSERT INTO user_project_catalog
           (user_id, project_id, title, color, duration_min, root_node_id, created_at, updated_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
         WHERE EXISTS (
           SELECT 1 FROM user_project_catalog
           WHERE user_id = ?1 AND project_id = ?2
         ) OR (
           SELECT COUNT(*) FROM user_project_catalog WHERE user_id = ?1
         ) < ?9
         ON CONFLICT(user_id, project_id) DO UPDATE SET
           title = excluded.title,
           color = excluded.color,
           duration_min = excluded.duration_min,
           root_node_id = excluded.root_node_id,
           updated_at = excluded.updated_at`,
      ).bind(
        userId,
        project!.projectId,
        project!.title,
        project!.color,
        project!.durationMin,
        project!.rootNodeId,
        project!.createdAt,
        now,
        MAX_PROJECTS,
      )));
      const placeholders = acceptedProjects.map((_, index) => `?${index + 2}`).join(", ");
      const admittedRows = await context.env.DB.prepare(
        `SELECT project_id FROM user_project_catalog
         WHERE user_id = ?1 AND project_id IN (${placeholders})`,
      ).bind(
        userId,
        ...acceptedProjects.map((project) => project!.projectId),
      ).all();
      const admittedIds = new Set(
        (admittedRows?.results || [])
          .map((row: Record<string, unknown>) => String(row.project_id || ""))
          .filter(Boolean),
      );
      const capacityRejected = acceptedProjects
        .map((project) => project!.projectId)
        .filter((projectId) => !admittedIds.has(projectId));
      if (capacityRejected.length) {
        return jsonResponse({
          error: `An account can contain at most ${MAX_PROJECTS} projects`,
          code: "PROJECT_LIMIT_REACHED",
          rejectedProjectIds: capacityRejected,
        }, { status: 409 });
      }
    }
    const result = {
      ok: true,
      updatedAt: now,
      count: acceptedProjects.length,
      rejectedProjectIds: projects
        .filter((project) => deletedProjectIds.has(project!.projectId))
        .map((project) => project!.projectId),
    };
    if (acceptedProjects.length) {
      await notifyAccountProjectCatalogChanged(context.env, userId).catch((error) => {
        console.warn("Account catalog realtime notification failed", error);
      });
    }
    return jsonResponse(result);
  } catch (error) {
    if (error instanceof Response) return error;
    const deleted = error instanceof Error && error.message.includes("PROJECT_DELETED");
    console.error("PUT /api/projects error", error);
    return jsonResponse({
      error: deleted ? "A deleted project cannot be recreated" : "Failed to update cloud project catalog",
      code: deleted ? "PROJECT_DELETED" : "PROJECT_CATALOG_UPDATE_FAILED",
    }, { status: deleted ? 409 : 500 });
  }
};
