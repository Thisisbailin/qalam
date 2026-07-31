import { createClient } from "@supabase/supabase-js";
import { getUserId, JSON_HEADERS } from "./_auth";
import { readJsonRequest } from "./_request";
import type { D1DatabaseLike, PagesContext } from "./_types";
import { normalizeProjectId } from "./_projectScope";
import { hasProjectCatalogEntry } from "./_projectCatalog";

type Env = {
  DB: D1DatabaseLike;
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
};

export type StorageDeleteObject = {
  bucket: "assets" | "public-assets";
  path: string;
};

const ALLOWED_BUCKETS = new Set<StorageDeleteObject["bucket"]>(["assets", "public-assets"]);
const MAX_REQUEST_BYTES = 24 * 1024;
const MAX_OBJECTS = 32;

const sanitizePath = (value: unknown) => {
  if (typeof value !== "string") return "";
  const cleaned = value
    .trim()
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      if (segment === "." || segment === "..") return "";
      return segment.replace(/[^\w.\-]+/g, "_");
    })
    .filter(Boolean)
    .join("/");
  return cleaned.slice(0, 240);
};

export const normalizeStorageDeleteObjects = (payload: unknown, userId: string, projectId: string): StorageDeleteObject[] => {
  const requested = Array.isArray((payload as { objects?: unknown })?.objects)
    ? (payload as { objects: unknown[] }).objects
    : [];
  if (!requested.length || requested.length > MAX_OBJECTS) {
    throw new Response(`objects must contain 1-${MAX_OBJECTS} entries`, { status: 400 });
  }

  const projectPrefix = `users/${userId}/projects/${projectId}/`;
  const unique = new Map<string, StorageDeleteObject>();
  requested.forEach((entry) => {
    const bucket = typeof (entry as { bucket?: unknown })?.bucket === "string"
      ? (entry as { bucket: string }).bucket.trim()
      : "";
    const path = sanitizePath((entry as { path?: unknown })?.path);
    if (!ALLOWED_BUCKETS.has(bucket as StorageDeleteObject["bucket"])) {
      throw new Response("bucket not allowed", { status: 400 });
    }
    if (!path) throw new Response("path required", { status: 400 });
    if (!path.startsWith(projectPrefix)) throw new Response("path forbidden", { status: 403 });
    const object = { bucket: bucket as StorageDeleteObject["bucket"], path };
    unique.set(`${object.bucket}:${object.path}`, object);
  });
  return [...unique.values()];
};

export const removeSupabaseStorageObjects = async (
  supabase: ReturnType<typeof createClient>,
  objects: StorageDeleteObject[]
) => {
  const grouped = new Map<StorageDeleteObject["bucket"], string[]>();
  objects.forEach((object) => {
    grouped.set(object.bucket, [...(grouped.get(object.bucket) || []), object.path]);
  });

  let removed = 0;
  for (const [bucket, paths] of grouped) {
    const { data, error } = await supabase.storage.from(bucket).remove(paths);
    if (error) throw error;
    removed += Array.isArray(data) ? data.length : paths.length;
  }
  return removed;
};

export const onRequestDelete = async ({ request, env }: PagesContext<Env>) => {
  try {
    const userId = await getUserId(request, env);
    const payload = await readJsonRequest<Record<string, unknown>>(request, MAX_REQUEST_BYTES);
    const projectId = normalizeProjectId(payload?.projectId);
    if (!projectId) return new Response("projectId required", { status: 400 });
    if (!await hasProjectCatalogEntry(env.DB, userId, projectId)) {
      return new Response("Project not found", { status: 404 });
    }
    const objects = normalizeStorageDeleteObjects(payload, userId, projectId);
    const supabaseUrl = env.SUPABASE_URL;
    const serviceRole = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !serviceRole) {
      console.error("Supabase delete configuration is incomplete");
      return new Response("Storage service unavailable", { status: 503 });
    }

    const removed = await removeSupabaseStorageObjects(createClient(supabaseUrl, serviceRole), objects);
    return Response.json({ removed }, { headers: JSON_HEADERS });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Storage object deletion failed", { message: error?.message || String(error) });
    return new Response("Unable to delete storage objects", { status: 502 });
  }
};
