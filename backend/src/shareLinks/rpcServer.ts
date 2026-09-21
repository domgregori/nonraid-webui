import { execFile } from 'node:child_process';
import { chmod, chown, mkdir, rm } from 'node:fs/promises';
import net, { type Socket } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  LogAccessParams,
  RecordDownloadParams,
  RecordEditParams,
  ReserveUploadBytesParams,
  ResolveShareForOpParams,
  ResolveShareForOpResult,
  ShareRpcMethodName,
  ShareRpcRequest,
  ShareRpcResponse,
  TrueUpUploadBytesParams,
  UnlockShareParams,
  UnlockShareResult,
} from '@nonraid/shared/share-link-rpc';
import { verifySecret } from '../auth/crypto.js';
import { config } from '../config.js';
import type { ShareLinkStore } from './store.js';

const execFileAsync = promisify(execFile);

/**
 * The entire boundary share-server (a separate, unprivileged OS process with zero filesystem
 * access to share_link.db) reaches this backend's share-link data through. A `net.createServer()`
 * Unix domain socket listener - no new dependency, `net` is built in - framed as
 * newline-delimited JSON, the same NDJSON convention already used elsewhere in this codebase
 * (POST /browse/bulk, POST /browse/search).
 *
 * Every method here operates on one already-identified share at a time; none of them ever return
 * the whole share_link table, and password_hash never appears in any response - unlockShare calls
 * verifySecret() internally and returns only the operational fields share-server actually needs.
 * A fully compromised share-server process (arbitrary code execution) still can't read another
 * share's root_path/password_hash, list the share table, or forge a password check - it has no
 * file-level access to the database at all, only these narrowly-typed calls.
 */
export class ShareLinkRpcServer {
  private readonly server: net.Server;
  private socketPath: string | null = null;

  constructor(private readonly store: ShareLinkStore) {
    this.server = net.createServer((socket) => this.handleConnection(socket));
    // A client that connects and immediately disconnects (or a genuinely broken pipe) should never
    // crash this backend - every other socket-level error in this app gets the same "log, don't
    // throw" treatment (see e.g. redirectServer.on('error', ...) in index.ts).
    this.server.on('error', (err) => {
      console.error(`Share RPC server error: ${(err as Error).message}`);
    });
  }

  /**
   * Binds the Unix socket and locks its permissions down to root + the share-server group only.
   * Best-effort on the permission-tightening steps (not the bind itself) - a host where
   * `shareServerGroup` doesn't exist yet (local dev, or install-webui.sh hasn't provisioned the
   * account yet) still gets a working socket, just root-owned only, rather than failing backend
   * startup entirely over it. Production always has the account (see
   * tools/install-webui.sh's ensure_share_server_account()), so this path is the real one there.
   */
  async start(socketPath: string = config.shareRpcSocketPath): Promise<void> {
    this.socketPath = socketPath;
    await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o750 }).catch((err) => {
      console.error(`Could not create the share RPC socket's parent directory (${(err as Error).message}) - share-server will not be able to connect.`);
    });
    await rm(socketPath, { force: true });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        this.server.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        this.server.removeListener('error', onError);
        resolve();
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(socketPath);
    });

    await chmod(socketPath, 0o660).catch((err) => {
      console.error(`Could not chmod the share RPC socket (${(err as Error).message}) - share-server may not be able to connect.`);
    });
    const gid = await resolveGid(config.shareServerGroup);
    if (gid !== null) {
      await chown(socketPath, 0, gid).catch((err) => {
        console.error(`Could not chown the share RPC socket to group "${config.shareServerGroup}" (${(err as Error).message}) - share-server may not be able to connect.`);
      });
    } else {
      console.error(`Group "${config.shareServerGroup}" does not exist yet - the share RPC socket is root-owned only until it does. Run tools/install-webui.sh to provision it.`);
    }
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    if (this.socketPath) await rm(this.socketPath, { force: true });
  }

  private handleConnection(socket: Socket): void {
    let buffer = '';
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) this.handleLine(socket, line);
      }
    });
    // A client disconnecting mid-request (share-server restarting, an RPC-unavailable-window
    // reconnect) is routine, not an error worth logging - see shareLinkRpcClient.ts's own
    // reconnect-with-backoff on the other end of this.
    socket.on('error', () => {});
  }

  private handleLine(socket: Socket, line: string): void {
    let req: ShareRpcRequest;
    try {
      req = JSON.parse(line) as ShareRpcRequest;
    } catch {
      return; // malformed frame, no id to reply to - drop it
    }
    const respond = (res: ShareRpcResponse) => {
      try {
        socket.write(`${JSON.stringify(res)}\n`);
      } catch {
        // socket already closed on the other end - nothing to do
      }
    };
    this.dispatch(req)
      .then((result) => respond({ id: req.id, result } as ShareRpcResponse))
      .catch((err) => respond({ id: req.id, error: err instanceof Error ? err.message : String(err) }));
  }

  private async dispatch(req: ShareRpcRequest): Promise<unknown> {
    switch (req.method as ShareRpcMethodName) {
      case 'unlockShare':
        return this.unlockShare(req.params as UnlockShareParams);
      case 'resolveShareForOp':
        return this.resolveShareForOp(req.params as ResolveShareForOpParams);
      case 'recordDownload':
        return this.recordDownload(req.params as RecordDownloadParams);
      case 'recordEdit':
        return this.recordEdit(req.params as RecordEditParams);
      case 'reserveUploadBytes':
        return this.reserveUploadBytes(req.params as ReserveUploadBytesParams);
      case 'trueUpUploadBytes':
        return this.trueUpUploadBytes(req.params as TrueUpUploadBytesParams);
      case 'logAccess':
        return this.logAccess(req.params as LogAccessParams);
      default:
        throw new Error(`Unknown RPC method: ${String(req.method)}`);
    }
  }

  private async unlockShare({ tokenHash, password }: UnlockShareParams): Promise<UnlockShareResult> {
    const record = this.store.getByTokenHash(tokenHash);
    // A nonexistent, revoked, or expired token all collapse to the same generic failure - nothing
    // distinguishes "this token never existed" from "it did, but is gone now" to an outside caller.
    if (!record || record.revokedAt !== null || (record.expiresAt !== null && record.expiresAt < Date.now())) {
      return { ok: false, reason: 'not_found' };
    }
    if (record.passwordHash !== null) {
      if (!password) return { ok: false, reason: 'password_required', label: record.label, mode: record.mode };
      if (!(await verifySecret(password, record.passwordHash))) return { ok: false, reason: 'wrong_password' };
    }
    this.store.touchLastAccessed(record.id);
    return {
      ok: true,
      shareId: record.id,
      mode: record.mode,
      allowDelete: record.allowDelete,
      rootPath: record.rootPath,
      label: record.label,
      uploadQuotaBytes: record.uploadQuotaBytes,
      maxFileSizeBytes: record.maxFileSizeBytes,
      uploadUsedBytes: record.uploadUsedBytes,
      expiresAt: record.expiresAt,
    };
  }

  private resolveShareForOp({ shareId }: ResolveShareForOpParams): ResolveShareForOpResult {
    const record = this.store.getById(shareId);
    if (!record) return { ok: false };
    if (record.revokedAt !== null) return { ok: false };
    if (record.expiresAt !== null && record.expiresAt < Date.now()) return { ok: false };
    return {
      ok: true,
      mode: record.mode,
      allowDelete: record.allowDelete,
      rootPath: record.rootPath,
      revoked: false,
      expired: false,
      uploadQuotaBytes: record.uploadQuotaBytes,
      maxFileSizeBytes: record.maxFileSizeBytes,
      uploadUsedBytes: record.uploadUsedBytes,
    };
  }

  private recordDownload({ shareId }: RecordDownloadParams) {
    this.store.recordDownload(shareId);
    return { ok: true as const };
  }

  private recordEdit({ shareId }: RecordEditParams) {
    this.store.touchLastAccessed(shareId);
    return { ok: true as const };
  }

  private reserveUploadBytes({ shareId, declaredBytes }: ReserveUploadBytesParams) {
    return { ok: this.store.reserveUploadBytes(shareId, declaredBytes) };
  }

  private trueUpUploadBytes({ shareId, deltaBytes }: TrueUpUploadBytesParams) {
    this.store.trueUpUploadBytes(shareId, deltaBytes);
    return { ok: true as const };
  }

  private logAccess({ shareId, kind, ip, detail }: LogAccessParams) {
    this.store.logAccess(shareId, kind, ip ?? null, detail ?? null);
    return { ok: true as const };
  }
}

async function resolveGid(groupName: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('getent', ['group', groupName], { timeout: 5_000 });
    const gid = Number(stdout.trim().split(':')[2]);
    return Number.isInteger(gid) ? gid : null;
  } catch {
    return null;
  }
}
