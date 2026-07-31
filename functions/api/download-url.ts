import { createClient } from '@supabase/supabase-js';
import { getUserId, JSON_HEADERS } from './_auth';
import { readJsonRequest } from './_request';
import type { D1DatabaseLike, PagesContext } from './_types';
import { normalizeProjectId } from './_projectScope';
import { hasProjectCatalogEntry } from './_projectCatalog';

type Env = {
  DB: D1DatabaseLike;
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
};

const ALLOWED_BUCKETS = new Set(['assets', 'public-assets']);
const MAX_REQUEST_BYTES = 16 * 1024;

const sanitizePath = (value: unknown) => {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .trim()
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      if (segment === '.' || segment === '..') return '';
      return segment.replace(/[^\w.\-]+/g, '_');
    })
    .filter(Boolean)
    .join('/');
  return cleaned.slice(0, 240);
};

const normalizeBucket = (value: unknown) => {
  const bucket = typeof value === 'string' ? value.trim() : 'assets';
  if (!ALLOWED_BUCKETS.has(bucket)) return null;
  return bucket;
};

const normalizeExpiresIn = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 3600;
  return Math.max(60, Math.min(24 * 60 * 60, Math.round(parsed)));
};

export const onRequestPost = async ({ request, env }: PagesContext<Env>) => {
  try {
    const userId = await getUserId(request, env);
    const payload = await readJsonRequest<Record<string, unknown>>(request, MAX_REQUEST_BYTES);
    const path = sanitizePath(payload?.path);
    const projectId = normalizeProjectId(payload?.projectId);
    const bucket = normalizeBucket(payload?.bucket ?? 'assets');
    const expiresIn = normalizeExpiresIn(payload?.expiresIn ?? 3600);
    if (!path || !projectId) {
      return new Response('path required', { status: 400 });
    }
    if (!bucket) {
      return new Response('bucket not allowed', { status: 400 });
    }
    if (!await hasProjectCatalogEntry(env.DB, userId, projectId)) {
      return new Response("Project not found", { status: 404 });
    }
    const projectPrefix = `users/${userId}/projects/${projectId}/`;
    if (!path.startsWith(projectPrefix)) {
      return new Response('path forbidden', { status: 403 });
    }
    const supabaseUrl = env.SUPABASE_URL;
    const serviceRole =
      env.SUPABASE_SERVICE_ROLE ||
      env.SUPABASE_SERVICE_ROLE_KEY ||
      env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !serviceRole) {
      console.error('Supabase download configuration is incomplete');
      return new Response('Storage service unavailable', { status: 503 });
    }

    const supabase = createClient(supabaseUrl, serviceRole);
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);

    if (error) {
      console.error('Supabase signed download URL failed', { message: error.message });
      return new Response('Unable to create download URL', { status: 502 });
    }

    return Response.json({
      signedUrl: data.signedUrl,
      expiresIn,
    }, { headers: JSON_HEADERS });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error('Signed download URL request failed', e);
    return new Response('Unexpected storage error', { status: 500 });
  }
};
