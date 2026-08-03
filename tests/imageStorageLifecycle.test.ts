import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  collectOwnedStorageObjects,
  collectUnreferencedOwnedStorageObjects,
} from "../node-workspace/nodeflow/storageReferences";
import {
  normalizeStorageDeleteObjects,
  removeSupabaseStorageObjects,
} from "../functions/api/storage-objects";

test("image nodes expose every owned Supabase object exactly once", () => {
  const objects = collectOwnedStorageObjects([
    {
      data: {
        storageBucket: "assets",
        storagePath: "users/user-1/projects/project-a/image-inputs/source.png",
        assetSourceBucket: "public-assets",
        assetSourcePath: "users/user-1/projects/project-a/seedance-assets/review.png",
      },
    },
    {
      data: {
        storageBucket: "assets",
        storagePath: "users/user-1/projects/project-a/image-inputs/source.png",
      },
    },
    { data: { image: "data:image/png;base64,legacy" } },
  ]);

  assert.deepEqual(objects, [
    { bucket: "assets", path: "users/user-1/projects/project-a/image-inputs/source.png" },
    { bucket: "public-assets", path: "users/user-1/projects/project-a/seedance-assets/review.png" },
  ]);
});

test("shared copied media is deleted only after its final node reference is removed", () => {
  const shared = {
    storageBucket: "assets",
    storagePath: "users/user-1/projects/project-a/image-inputs/shared.png",
  };
  const audit = {
    assetSourceBucket: "public-assets",
    assetSourcePath: "users/user-1/projects/project-a/seedance-assets/audit.png",
  };

  assert.deepEqual(
    collectUnreferencedOwnedStorageObjects(
      [{ data: { ...shared, ...audit } }],
      [{ data: { ...shared } }]
    ),
    [{ bucket: "public-assets", path: "users/user-1/projects/project-a/seedance-assets/audit.png" }]
  );
  assert.deepEqual(
    collectUnreferencedOwnedStorageObjects([{ data: { ...shared } }], []),
    [{ bucket: "assets", path: "users/user-1/projects/project-a/image-inputs/shared.png" }]
  );
});

test("storage deletion accepts only allow-listed objects owned by the authenticated user", () => {
  assert.deepEqual(
    normalizeStorageDeleteObjects({
      objects: [
        { bucket: "assets", path: "/users/user-1/projects/project-a/image-inputs/source.png" },
        { bucket: "assets", path: "users/user-1/projects/project-a/image-inputs/source.png" },
      ],
    }, "user-1", "project-a"),
    [{ bucket: "assets", path: "users/user-1/projects/project-a/image-inputs/source.png" }]
  );

  assert.throws(
    () => normalizeStorageDeleteObjects({ objects: [{ bucket: "private", path: "users/user-1/projects/project-a/file.png" }] }, "user-1", "project-a"),
    (error: unknown) => error instanceof Response && error.status === 400
  );
  assert.throws(
    () => normalizeStorageDeleteObjects({ objects: [{ bucket: "assets", path: "users/user-1/projects/project-b/file.png" }] }, "user-1", "project-a"),
    (error: unknown) => error instanceof Response && error.status === 403
  );
});

test("Supabase deletion groups paths by bucket", async () => {
  const calls: Array<{ bucket: string; paths: string[] }> = [];
  const supabase = {
    storage: {
      from(bucket: string) {
        return {
          async remove(paths: string[]) {
            calls.push({ bucket, paths });
            return { data: paths.map((name) => ({ name })), error: null };
          },
        };
      },
    },
  };

  const removed = await removeSupabaseStorageObjects(supabase as never, [
    { bucket: "assets", path: "users/user-1/a.png" },
    { bucket: "public-assets", path: "users/user-1/b.png" },
    { bucket: "assets", path: "users/user-1/c.png" },
  ]);

  assert.equal(removed, 3);
  assert.deepEqual(calls, [
    { bucket: "assets", paths: ["users/user-1/a.png", "users/user-1/c.png"] },
    { bucket: "public-assets", paths: ["users/user-1/b.png"] },
  ]);
});

test("image card and connection feedback use image-first and theme-driven styling", async () => {
  const [component, audioComponent, videoComponent, css] = await Promise.all([
    readFile(path.resolve("node-workspace/nodes/ImageInputNode.tsx"), "utf8"),
    readFile(path.resolve("node-workspace/nodes/AudioInputNode.tsx"), "utf8"),
    readFile(path.resolve("node-workspace/nodes/VideoInputNode.tsx"), "utf8"),
    readFile(path.resolve("node-workspace/styles/nodeflow.css"), "utf8"),
  ]);

  assert.match(component, /nodeType="imageInput"/);
  assert.match(component, /image-input-control-rail/);
  assert.equal(component.match(/className="image-input-icon-label"/g)?.length, 3);
  assert.match(component, /readImageHasAlpha\(file\)/);
  assert.match(component, /hasAlpha,/);
  assert.match(component, /data-sticker=\{data\.hasAlpha \|\| undefined\}/);
  assert.doesNotMatch(component, /<div className="media-input-info">/);
  assert.doesNotMatch(component, /image-input-action-label/);
  assert.match(css, /\.image-input-control-rail/);
  assert.match(css, /\.image-input-media\s*\{[\s\S]*background:\s*transparent/);
  assert.match(css, /data-node-type="imageInput"\]\s+\.node-card-shell::before[\s\S]*background:\s*transparent/);
  assert.match(css, /\.image-input-icon-label/);
  assert.match(component, /image-input-empty media-input-empty/);
  assert.match(audioComponent, /className="media-input-empty"/);
  assert.match(videoComponent, /className="media-input-empty"/);
  assert.match(css, /\.text-node-shell\[data-has-content="false"\] \.text-node-editor[\s\S]*justify-content: center/);
  assert.match(css, /\.media-input-empty \{[\s\S]*border: 1px solid var\(--node-border\)/);
  assert.match(css, /var\(--app-accent\)/);
  assert.doesNotMatch(css, /rgba\(74, 222, 128/);
});
