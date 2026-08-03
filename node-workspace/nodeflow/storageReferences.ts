export type OwnedStorageObject = {
  bucket: "assets" | "public-assets";
  path: string;
};

type StorageBackedNode = {
  data?: Record<string, unknown> | null;
};

const ALLOWED_BUCKETS = new Set<OwnedStorageObject["bucket"]>(["assets", "public-assets"]);

const toStorageObject = (bucket: unknown, path: unknown): OwnedStorageObject | null => {
  if (typeof bucket !== "string" || !ALLOWED_BUCKETS.has(bucket as OwnedStorageObject["bucket"])) return null;
  if (typeof path !== "string" || !path.trim()) return null;
  return { bucket: bucket as OwnedStorageObject["bucket"], path: path.trim().replace(/^\/+/, "") };
};

export const collectOwnedStorageObjects = (nodes: StorageBackedNode[]): OwnedStorageObject[] => {
  const objects = new Map<string, OwnedStorageObject>();
  nodes.forEach((node) => {
    const data = node.data || {};
    [
      toStorageObject(data.storageBucket, data.storagePath),
      toStorageObject(data.assetSourceBucket, data.assetSourcePath),
    ].forEach((object) => {
      if (object) objects.set(`${object.bucket}:${object.path}`, object);
    });
  });
  return [...objects.values()];
};

export const collectUnreferencedOwnedStorageObjects = (
  removedNodes: StorageBackedNode[],
  retainedNodes: StorageBackedNode[]
): OwnedStorageObject[] => {
  const retainedKeys = new Set(
    collectOwnedStorageObjects(retainedNodes).map((object) => `${object.bucket}:${object.path}`)
  );
  return collectOwnedStorageObjects(removedNodes).filter(
    (object) => !retainedKeys.has(`${object.bucket}:${object.path}`)
  );
};
