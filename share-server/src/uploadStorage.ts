import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Request } from 'express';
import type { StorageEngine } from 'multer';
import { config } from './config.js';
import type { ShareLinkRpcClient } from './shareLinkRpcClient.js';

export class UploadRejectedError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'UploadRejectedError';
    this.status = status;
  }
}

export interface UploadContext {
  shareId: string;
  // Upper bound reserved atomically (via reserveUploadBytes) before a single byte is written -
  // never exceeded by what actually lands on disk, since maxFileSizeBytes (when set) is enforced
  // as a hard mid-stream ceiling below. See ProgressDiskStorage's own doc comment for why this
  // sizing choice keeps the reservation race-safe even though multipart requests never declare a
  // real per-file size upfront.
  reserveHintBytes: number;
  maxFileSizeBytes: number | null;
  rpc: ShareLinkRpcClient;
  onProgress?: (originalName: string, bytesWritten: number) => void;
}

const contexts = new WeakMap<Request, UploadContext>();
export function setUploadContext(req: Request, ctx: UploadContext): void {
  contexts.set(req, ctx);
}
export function getUploadContext(req: Request): UploadContext | undefined {
  return contexts.get(req);
}

/**
 * Custom multer StorageEngine (not multer.diskStorage) - none of this feature's mechanics fit that
 * engine's plain hooks: an atomic quota *reservation* must happen over the RPC socket before a
 * single byte is written, the per-file cap must be enforced as a hard ceiling mid-stream (multer's
 * own `limits.fileSize` only truncates the read, it can't reconcile a reservation afterward), and
 * NDJSON progress needs a tick per chunk. Streams straight to a temp file under
 * config.uploadTmpDir; the route handler validates the real destination (via the share's own
 * PathSandbox) and renames into place afterward - same temp-then-rename shape
 * backend/src/browse/service.ts's saveUpload() uses, right down to the EXDEV/ENOTCONN fallback.
 *
 * Multipart uploads never declare a real per-file size upfront (Content-Length covers the whole
 * request body, not each part), so `reserveHintBytes` - computed by the route handler as
 * `maxFileSizeBytes ?? min(remaining cumulative quota, a fixed ceiling)` - is a deliberately
 * pessimistic upper bound: reserve that much before streaming, enforce it (or the tighter
 * maxFileSizeBytes cap) as a hard ceiling while writing, then true-up the difference once the
 * real size is known. The reservation can therefore never be exceeded by what's actually written,
 * which is what keeps reserveUploadBytes's atomic SQL UPDATE (see backend/src/shareLinks/store.ts)
 * a genuine race-safe guarantee rather than just an advisory check.
 */
export class ProgressDiskStorage implements StorageEngine {
  _handleFile(req: Request, file: Express.Multer.File, callback: (error?: unknown, info?: Partial<Express.Multer.File>) => void): void {
    const ctx = getUploadContext(req);
    if (!ctx) {
      file.stream.resume();
      callback(new UploadRejectedError('No upload context set for this request.', 500));
      return;
    }
    this.handle(ctx, file, callback).catch((err) => callback(err));
  }

  private async handle(
    ctx: UploadContext,
    file: Express.Multer.File,
    callback: (error?: unknown, info?: Partial<Express.Multer.File>) => void,
  ): Promise<void> {
    const reserved = await ctx.rpc.reserveUploadBytes({ shareId: ctx.shareId, declaredBytes: ctx.reserveHintBytes });
    if (!reserved.ok) {
      file.stream.resume(); // drain so the client's request doesn't hang on backpressure
      callback(new UploadRejectedError('Upload quota exceeded.', 413));
      return;
    }

    await mkdir(config.uploadTmpDir, { recursive: true });
    const tempPath = path.join(config.uploadTmpDir, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const writeStream = createWriteStream(tempPath);
    let bytesWritten = 0;
    let settled = false;

    const trueUp = async (finalBytes: number) => {
      const delta = finalBytes - ctx.reserveHintBytes;
      if (delta !== 0) await ctx.rpc.trueUpUploadBytes({ shareId: ctx.shareId, deltaBytes: delta }).catch(() => {});
    };

    const abort = (err: unknown) => {
      if (settled) return;
      settled = true;
      file.stream.resume();
      writeStream.destroy();
      unlink(tempPath).catch(() => {});
      trueUp(0).finally(() => callback(err));
    };

    file.stream.on('data', (chunk: Buffer) => {
      if (settled) return;
      if (ctx.maxFileSizeBytes !== null && bytesWritten + chunk.length > ctx.maxFileSizeBytes) {
        abort(new UploadRejectedError(`"${file.originalname}" exceeds this share's ${ctx.maxFileSizeBytes}-byte per-file limit.`, 413));
        return;
      }
      bytesWritten += chunk.length;
      ctx.onProgress?.(file.originalname, bytesWritten);
    });
    file.stream.on('error', abort);
    writeStream.on('error', abort);
    writeStream.on('finish', () => {
      if (settled) return;
      settled = true;
      trueUp(bytesWritten).then(() => callback(null, { path: tempPath, size: bytesWritten }));
    });

    file.stream.pipe(writeStream);
  }

  _removeFile(_req: Request, file: Express.Multer.File, callback: (error: Error | null) => void): void {
    unlink(file.path)
      .then(() => callback(null))
      .catch(() => callback(null));
  }
}
