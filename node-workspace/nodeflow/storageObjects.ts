import { buildApiUrl } from "../../utils/api";
import { buildAuthorizedJsonHeaders } from "../../utils/authToken";
import {
  collectOwnedStorageObjects,
  collectUnreferencedOwnedStorageObjects,
  type OwnedStorageObject,
} from "./storageReferences";

export {
  collectOwnedStorageObjects,
  collectUnreferencedOwnedStorageObjects,
  type OwnedStorageObject,
} from "./storageReferences";

export const deleteOwnedStorageObjects = async (objects: OwnedStorageObject[], projectId: string) => {
  const uniqueObjects = collectOwnedStorageObjects(objects.map((object) => ({
    data: { storageBucket: object.bucket, storagePath: object.path },
  })));
  if (!uniqueObjects.length) return { removed: 0 };

  const response = await fetch(buildApiUrl("/api/storage-objects"), {
    method: "DELETE",
    headers: await buildAuthorizedJsonHeaders(),
    body: JSON.stringify({ projectId, objects: uniqueObjects }),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`云端素材删除失败 (${response.status}): ${message}`);
  }
  return response.json() as Promise<{ removed: number }>;
};

export const resolvePrivateStorageUrl = async (object: OwnedStorageObject, projectId: string) => {
  const response = await fetch(buildApiUrl("/api/download-url"), {
    method: "POST",
    headers: await buildAuthorizedJsonHeaders(),
    body: JSON.stringify({ projectId, bucket: object.bucket, path: object.path, expiresIn: 24 * 60 * 60 }),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`图片访问地址刷新失败 (${response.status}): ${message}`);
  }
  const payload = await response.json() as { signedUrl?: string };
  if (!payload?.signedUrl) throw new Error("图片访问地址刷新失败：缺少 signedUrl。");
  return payload.signedUrl as string;
};

export const uploadStorageFile = async (
  file: Blob,
  options: {
    fileName: string;
    bucket: OwnedStorageObject["bucket"];
    contentType: string;
    projectId: string;
  }
) => {
  const signedResponse = await fetch(buildApiUrl("/api/upload-url"), {
    method: "POST",
    headers: await buildAuthorizedJsonHeaders(),
    body: JSON.stringify({ ...options, fileSize: file.size }),
  });
  if (!signedResponse.ok) {
    const message = await signedResponse.text();
    throw new Error(`图片上传地址创建失败 (${signedResponse.status}): ${message}`);
  }
  const signedPayload = await signedResponse.json() as {
    signedUrl?: string;
    path?: string;
    publicUrl?: string;
  };
  if (!signedPayload?.signedUrl || !signedPayload?.path) {
    throw new Error("图片上传地址创建失败：缺少对象路径。");
  }

  const uploadResponse = await fetch(signedPayload.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": options.contentType },
    body: file,
  });
  if (!uploadResponse.ok) {
    const message = await uploadResponse.text();
    throw new Error(`图片上传失败 (${uploadResponse.status}): ${message}`);
  }

  const object: OwnedStorageObject = {
    bucket: options.bucket,
    path: signedPayload.path,
  };
  const url = typeof signedPayload.publicUrl === "string" && signedPayload.publicUrl
    ? signedPayload.publicUrl
    : await resolvePrivateStorageUrl(object, options.projectId);
  return { object, url };
};
