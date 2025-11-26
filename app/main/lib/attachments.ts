import { app, protocol } from "electron";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import log from "electron-log";
import {
  BreakMessageAttachment,
  MAX_BREAK_ATTACHMENT_BYTES,
} from "../../types/settings";

type SaveOptions = {
  mimeType?: string;
  name?: string;
  sizeBytes?: number;
};

const ATTACHMENTS_DIR = path.join(app.getPath("userData"), "attachments");
let protocolRegistered = false;

function ensureAttachmentsDir(): void {
  if (!fs.existsSync(ATTACHMENTS_DIR)) {
    fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
  }
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "");
}

function inferExtension(options: SaveOptions): string {
  const { mimeType, name } = options;
  if (name) {
    const ext = path.extname(name);
    if (ext) {
      return ext;
    }
  }

  if (mimeType) {
    const genericExt = mimeType.split("/")[1];
    if (genericExt) {
      if (genericExt === "svg+xml") {
        return ".svg";
      }
      return `.${genericExt}`;
    }
  }

  return "";
}

function toBufferFromDataUrl(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) {
    throw new Error("Invalid data URL format");
  }

  const base64 = match[2];
  return Buffer.from(base64, "base64");
}

function buildAttachmentMetadata(
  storageName: string,
  bufferLength: number,
  options: SaveOptions,
): BreakMessageAttachment {
  const uri = `attachment://${encodeURIComponent(storageName)}`;

  return {
    id: storageName,
    type: "image",
    uri,
    mimeType: options.mimeType,
    name: options.name,
    sizeBytes: bufferLength,
  };
}

export function initAttachmentStore(): void {
  ensureAttachmentsDir();

  if (!protocolRegistered) {
    protocol.registerFileProtocol("attachment", (request, callback) => {
      try {
        const fileName = decodeURIComponent(
          request.url.replace("attachment://", ""),
        );
        if (fileName.includes("/") || fileName.includes("\\")) {
          callback({ error: -6 });
          return;
        }

        const safeName = sanitizeFileName(fileName);
        const fullPath = path.join(ATTACHMENTS_DIR, safeName);
        callback({ path: fullPath });
      } catch (error) {
        log.error("Failed to resolve attachment protocol", error);
        callback({ error: -2 });
      }
    });

    protocolRegistered = true;
  }
}

export function saveAttachmentFromDataUrl(
  dataUrl: string,
  options: SaveOptions,
): BreakMessageAttachment {
  ensureAttachmentsDir();

  const buffer = toBufferFromDataUrl(dataUrl);
  if (buffer.length > MAX_BREAK_ATTACHMENT_BYTES) {
    throw new Error("Attachment exceeds maximum size");
  }

  return saveAttachmentFromBuffer(buffer, options);
}

export function saveAttachmentFromBuffer(
  buffer: Buffer,
  options: SaveOptions,
): BreakMessageAttachment {
  ensureAttachmentsDir();

  const extension = inferExtension(options);
  const storageName = sanitizeFileName(`${randomUUID()}${extension}`);
  const fullPath = path.join(ATTACHMENTS_DIR, storageName);

  fs.writeFileSync(fullPath, buffer);

  return buildAttachmentMetadata(storageName, buffer.length, options);
}

export function deleteAttachment(storageName: string): void {
  const safeName = sanitizeFileName(storageName);
  if (!safeName) {
    return;
  }

  const fullPath = path.join(ATTACHMENTS_DIR, safeName);
  try {
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (error) {
    log.warn("Failed to delete attachment", storageName, error);
  }
}

export function attachmentExists(storageName: string): boolean {
  const safeName = sanitizeFileName(storageName);
  if (!safeName) {
    return false;
  }

  const fullPath = path.join(ATTACHMENTS_DIR, safeName);
  return fs.existsSync(fullPath);
}
