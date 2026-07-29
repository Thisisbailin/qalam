import assert from "node:assert/strict";
import { test } from "node:test";
import type { NodeFlowFile } from "../node-workspace/types";
import {
  buildNodeFlowPackageBlob,
  readNodeFlowImportFile,
} from "../node-workspace/nodeflow/package";
import { NODE_FLOW_IMPORT_LIMITS } from "../node-workspace/nodeflow/schema";

const makeTextProject = (): NodeFlowFile => ({
  version: 2,
  revision: 7,
  name: "Package Test",
  nodes: [{
    id: "text-1",
    type: "text",
    position: { x: 12, y: 34 },
    data: {
      title: "第一幕",
      text: "第一幕\n\n这是需要完整往返的正文。",
    },
  }],
  links: [],
  graphLinks: [],
});

const crc32 = (data: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const replaceAscii = (bytes: Uint8Array, start: number, length: number, from: string, to: string) => {
  assert.equal(from.length, to.length, "ZIP fixture replacements must preserve byte length");
  const source = new TextEncoder().encode(from);
  const replacement = new TextEncoder().encode(to);
  const end = start + length - source.length;
  for (let offset = start; offset <= end; offset += 1) {
    if (!source.every((byte, index) => bytes[offset + index] === byte)) continue;
    bytes.set(replacement, offset);
    offset += source.length - 1;
  }
};

const convertToLegacyQalamPackage = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const checksums = new Map<number, number>();
  let cursor = 0;

  while (view.getUint32(cursor, true) === 0x04034b50) {
    const compressedSize = view.getUint32(cursor + 18, true);
    const nameLength = view.getUint16(cursor + 26, true);
    const extraLength = view.getUint16(cursor + 28, true);
    const dataOffset = cursor + 30 + nameLength + extraLength;
    replaceAscii(bytes, cursor + 30, nameLength, "stylo", "qalam");
    replaceAscii(bytes, dataOffset, compressedSize, "stylo", "qalam");
    const checksum = crc32(bytes.subarray(dataOffset, dataOffset + compressedSize));
    view.setUint32(cursor + 14, checksum, true);
    checksums.set(cursor, checksum);
    cursor = dataOffset + compressedSize;
  }

  while (view.getUint32(cursor, true) === 0x02014b50) {
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    replaceAscii(bytes, cursor + 46, nameLength, "stylo", "qalam");
    view.setUint32(cursor + 16, checksums.get(localHeaderOffset) ?? 0, true);
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return new Blob([bytes], { type: "application/zip" });
};

test("Stylo package round-trip restores packed document content", async () => {
  const original = makeTextProject();
  const originalText = original.nodes[0]?.data.text;
  const blob = await buildNodeFlowPackageBlob(original);
  const imported = await readNodeFlowImportFile(new File(
    [blob],
    "package-test.stylo.zip",
    { type: "application/zip" }
  ));

  assert.equal(imported.version, 2);
  assert.equal(imported.revision, original.revision);
  assert.equal(imported.nodes[0]?.data.text, originalText);
  assert.equal("styloPackageResources" in (imported.nodes[0]?.data || {}), false);
  assert.equal(original.nodes[0]?.data.text, originalText, "packing must not mutate the source project");
});

test("Stylo packages store Manus pages as Fountain children of the screenplay folder", async () => {
  const original: NodeFlowFile = {
    version: 2,
    revision: 1,
    name: "Manus Package",
    nodes: [
      {
        id: "manus-folder",
        type: "folder",
        position: { x: 0, y: 0 },
        data: {
          title: "雾中来客",
          folderKind: "manus",
          systemManaged: true,
          manuscriptId: "manuscript-main",
        },
      },
      {
        id: "page-1",
        type: "scriptPage",
        position: { x: 320, y: 0 },
        data: {
          title: "雾中来客",
          text: "INT. 车站 - 夜",
          documentKind: "script",
          format: "fountain",
          manuscriptId: "manuscript-main",
          pageNumber: 1,
        },
      },
      {
        id: "page-2",
        type: "scriptPage",
        position: { x: 680, y: 0 },
        data: {
          title: "雾中来客",
          text: "沈\n你来了。",
          documentKind: "script",
          format: "fountain",
          manuscriptId: "manuscript-main",
          pageNumber: 2,
        },
      },
    ],
    links: [
      {
        id: "folder-page-1",
        source: "manus-folder",
        target: "page-1",
        sourceHandle: "contains",
        targetHandle: "contains",
        data: { relation: "folder-membership" },
      },
      {
        id: "folder-page-2",
        source: "manus-folder",
        target: "page-2",
        sourceHandle: "contains",
        targetHandle: "contains",
        data: { relation: "folder-membership" },
      },
      {
        id: "page-order",
        source: "page-1",
        target: "page-2",
        sourceHandle: "text",
        targetHandle: "text",
        data: { relation: "screenplay-page" },
      },
    ],
  };

  const blob = await buildNodeFlowPackageBlob(original);
  const zipText = new TextDecoder().decode(await blob.arrayBuffer());
  assert.match(zipText, /项目文件夹\/雾中来客\/001 雾中来客\.fountain/);
  assert.match(zipText, /项目文件夹\/雾中来客\/002 雾中来客\.fountain/);

  const imported = await readNodeFlowImportFile(
    new File([blob], "manus.stylo.zip", { type: "application/zip" })
  );
  assert.equal(imported.nodes.filter((node) => node.type === "folder").length, 1);
  assert.equal(
    imported.links.filter((link) => link.data?.relation === "folder-membership").length,
    2
  );
  assert.equal(imported.nodes.find((node) => node.id === "page-1")?.data.text, "INT. 车站 - 夜");
  assert.equal(imported.nodes.find((node) => node.id === "page-2")?.data.text, "沈\n你来了。");
});

test("legacy Qalam packages remain importable during the Stylo migration", async () => {
  const original = makeTextProject();
  const currentPackage = await buildNodeFlowPackageBlob(original);
  const legacyPackage = await convertToLegacyQalamPackage(currentPackage);
  const imported = await readNodeFlowImportFile(new File(
    [legacyPackage],
    "package-test.qalam.zip",
    { type: "application/zip" }
  ));

  assert.equal(imported.nodes[0]?.data.text, original.nodes[0]?.data.text);
  assert.equal("qalamPackageResources" in (imported.nodes[0]?.data || {}), false);
  assert.equal("styloPackageResources" in (imported.nodes[0]?.data || {}), false);
});

test("JSON imports use the same schema migration boundary", async () => {
  const legacy = {
    name: "Legacy JSON",
    nodes: [
      { id: "a", type: "text", position: { x: 0, y: 0 }, data: { text: "A" } },
      { id: "b", type: "text", position: { x: 1, y: 1 }, data: { text: "B" } },
    ],
    edges: [{ source: "a", target: "b" }],
  };
  const file = new File([JSON.stringify(legacy)], "legacy.json", { type: "application/json" });

  const imported = await readNodeFlowImportFile(file);

  assert.equal(imported.version, 2);
  assert.equal(imported.links[0]?.id, "link-imported-1");
});

test("invalid JSON, corrupt ZIPs, and oversized JSON fail closed", async () => {
  await assert.rejects(
    () => readNodeFlowImportFile(new File(["{"], "broken.json", { type: "application/json" })),
    /不是有效的 JSON/
  );
  await assert.rejects(
    () => readNodeFlowImportFile(new File([new Uint8Array([1, 2, 3, 4])], "broken.zip", { type: "application/zip" })),
    /zip/i
  );

  let readAttempted = false;
  const oversizedFile = {
    name: "oversized.json",
    type: "application/json",
    size: NODE_FLOW_IMPORT_LIMITS.jsonBytes + 1,
    text: async () => {
      readAttempted = true;
      return "{}";
    },
  } as File;
  await assert.rejects(
    () => readNodeFlowImportFile(oversizedFile),
    /超过 25 MB 限制/
  );
  assert.equal(readAttempted, false, "oversized input must be rejected before reading its body");
});

test("package hydration cannot write resources into arbitrary node fields", async () => {
  const malicious = makeTextProject();
  malicious.nodes[0].data = {
    ...malicious.nodes[0].data,
    styloPackageResources: {
      subjects: {
        kind: "document",
        path: ".stylo/nodeflow.json",
      },
    },
  } as never;
  const blob = await buildNodeFlowPackageBlob(malicious);
  await assert.rejects(
    () => readNodeFlowImportFile(new File([blob], "malicious.stylo.zip", { type: "application/zip" })),
    /不允许资源字段 subjects/
  );
});
