import { createClient } from '@supabase/supabase-js';
import { getUserId, JSON_HEADERS } from './_auth';
import { readJsonRequest } from './_request';
import type { PagesContext } from './_types';
import type { D1DatabaseLike } from './_types';
import { normalizeProjectId } from './_projectScope';
import { admitProjectCatalogEntry } from './_projectCatalog';
import { enforceRateLimit } from './_rateLimit';

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
const PUBLIC_BUCKETS = new Set(['public-assets']);
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_PRIVATE_UPLOAD_BYTES = 64 * 1024 * 1024;
const MAX_PUBLIC_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_AVATAR_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED_PRIVATE_CONTENT_TYPES = new Set([
  'application/pdf',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);
const ALLOWED_PUBLIC_CONTENT_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

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

const normalizeContentType = (value: unknown) => {
  if (typeof value !== 'string') return '';
  return value.split(';', 1)[0].trim().toLowerCase().slice(0, 120);
};

const normalizeFileSize = (value: unknown) => {
  const size = Number(value);
  return Number.isSafeInteger(size) && size > 0 ? size : 0;
};

export const onRequestPost = async ({ request, env }: PagesContext<Env>) => {
  try {
    const userId = await getUserId(request, env);
    const payload = await readJsonRequest<Record<string, unknown>>(request, MAX_REQUEST_BYTES);
    const requestedFileName = sanitizePath(payload?.fileName);
    const projectId = normalizeProjectId(payload?.projectId);
    const isAccountAvatar = !projectId && requestedFileName.startsWith('avatars/');
    const bucket = normalizeBucket(payload?.bucket ?? 'assets');
    const contentType = normalizeContentType(payload?.contentType);
    const fileSize = normalizeFileSize(payload?.fileSize);
    if (!requestedFileName || (!projectId && !isAccountAvatar)) {
      return new Response('fileName and projectId required', { status: 400 });
    }
    if (!bucket) {
      return new Response('bucket not allowed', { status: 400 });
    }
    if (!fileSize) {
      return new Response('fileSize required', { status: 400 });
    }
    if (isAccountAvatar && bucket !== 'public-assets') {
      return new Response('account avatars require public-assets', { status: 400 });
    }
    const isPublicUpload = PUBLIC_BUCKETS.has(bucket);
    const allowedContentTypes = isPublicUpload
      ? ALLOWED_PUBLIC_CONTENT_TYPES
      : ALLOWED_PRIVATE_CONTENT_TYPES;
    if (!allowedContentTypes.has(contentType)) {
      return new Response('contentType not allowed', { status: 415 });
    }
    const maxFileSize = isAccountAvatar
      ? MAX_AVATAR_UPLOAD_BYTES
      : isPublicUpload
        ? MAX_PUBLIC_UPLOAD_BYTES
        : MAX_PRIVATE_UPLOAD_BYTES;
    if (fileSize > maxFileSize) {
      return new Response(`file exceeds ${Math.floor(maxFileSize / 1024 / 1024)} MiB limit`, {
        status: 413,
      });
    }
    const rateSubject = projectId ? `${userId}:${projectId}` : `${userId}:account`;
    await enforceRateLimit({
      db: env.DB,
      namespace: 'storage-upload-minute',
      subject: rateSubject,
      limit: 12,
      windowSeconds: 60,
    });
    await enforceRateLimit({
      db: env.DB,
      namespace: 'storage-upload-hour',
      subject: userId,
      limit: isAccountAvatar ? 12 : 64,
      windowSeconds: 3_600,
    });
    if (projectId) {
      const admission = await admitProjectCatalogEntry(env.DB, userId, projectId);
      if (admission === "deleted") {
        return new Response("Project was permanently deleted", { status: 410 });
      }
      if (admission === "limit") {
        return new Response("Account project limit reached", { status: 409 });
      }
    }
    const supabaseUrl = env.SUPABASE_URL;
    const serviceRole =
      env.SUPABASE_SERVICE_ROLE ||
      env.SUPABASE_SERVICE_ROLE_KEY ||
      env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !serviceRole) {
      console.error('Supabase upload configuration is incomplete');
      return new Response('Storage service unavailable', { status: 503 });
    }

    const supabase = createClient(supabaseUrl, serviceRole);
    const projectPrefix = projectId
      ? `users/${userId}/projects/${projectId}/`
      : `users/${userId}/account/`;
    const fileName = requestedFileName.startsWith(projectPrefix)
      ? requestedFileName
      : `${projectPrefix}${requestedFileName}`;
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(fileName, { upsert: false });

    if (error) {
      console.error('Supabase signed upload URL failed', { message: error.message });
      return new Response('Unable to create upload URL', { status: 502 });
    }

    let publicUrl: string | undefined;
    if (PUBLIC_BUCKETS.has(bucket)) {
      const publicResult = supabase.storage.from(bucket).getPublicUrl(data.path);
      if (publicResult?.data?.publicUrl) {
        publicUrl = publicResult.data.publicUrl;
      }
    }

    return Response.json({
      signedUrl: data.signedUrl,
      path: data.path,
      bucket,
      publicUrl,
      storageRef: {
        provider: 'supabase',
        bucket,
        path: data.path,
        isPublic: PUBLIC_BUCKETS.has(bucket),
      },
    }, { headers: JSON_HEADERS });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error('Signed upload URL request failed', e);
    return new Response('Unexpected storage error', { status: 500 });
  }
};
