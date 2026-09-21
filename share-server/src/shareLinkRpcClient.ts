import net, { type Socket } from 'node:net';
import type {
  LogAccessParams,
  RecordDownloadParams,
  RecordEditParams,
  ReserveUploadBytesParams,
  ReserveUploadBytesResult,
  ResolveShareForOpResult,
  ShareRpcMethodName,
  ShareRpcMethods,
  ShareRpcRequest,
  ShareRpcResponse,
  TrueUpUploadBytesParams,
  UnlockShareParams,
  UnlockShareResult,
} from '@nonraid/shared/share-link-rpc';
import { config } from './config.js';

/** Thrown by every call when the admin backend is unreachable (mid-reconnect, or the socket never
 *  came up at all) - routes catch this specifically and return a clean 503 rather than crashing or
 *  hanging. The admin backend restarts on its own for TLS/timezone changes and self-updates; a
 *  brief window of this during that is expected, not a bug. */
export class RpcUnavailableError extends Error {
  constructor(message = 'The admin backend is temporarily unreachable. Try again shortly.') {
    super(message);
    this.name = 'RpcUnavailableError';
  }
}

interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

interface ResolveCacheEntry {
  result: ResolveShareForOpResult;
  expiresAt: number;
}

/**
 * The entire channel this process has to the admin backend - a thin client over the Unix socket
 * RPC server (backend/src/shareLinks/rpcServer.ts), newline-delimited JSON, request ids correlate
 * responses back to their caller. No other path to the admin backend exists from this process at
 * all - no HTTP client pointed at the admin API, no shared filesystem access to its database.
 *
 * Reconnects with exponential backoff (capped) whenever the connection drops; every in-flight and
 * new call during a disconnected window rejects immediately with RpcUnavailableError rather than
 * queuing indefinitely, so a caller (an Express route) can turn that into a prompt 503 instead of
 * a hung request.
 */
export class ShareLinkRpcClient {
  private socket: Socket | null = null;
  private connected = false;
  private connecting = false;
  private closed = false;
  private nextId = 1;
  private buffer = '';
  private readonly pending = new Map<number, PendingCall>();
  private reconnectDelayMs = config.rpcReconnectMinDelayMs;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly resolveCache = new Map<string, ResolveCacheEntry>();

  connect(): void {
    if (this.closed || this.connecting || this.connected) return;
    this.connecting = true;
    const socket = net.createConnection(config.shareRpcSocketPath);
    this.socket = socket;

    socket.once('connect', () => {
      this.connecting = false;
      this.connected = true;
      this.reconnectDelayMs = config.rpcReconnectMinDelayMs;
      console.log(`Connected to the admin backend RPC socket at ${config.shareRpcSocketPath}`);
    });
    socket.on('data', (chunk: Buffer) => this.handleData(chunk));
    // 'error' always fires alongside 'close' for a failed connection attempt - swallowing it here
    // (rather than letting it become an uncaught exception) and letting 'close' below drive the
    // actual reconnect scheduling avoids handling the same failure twice.
    socket.on('error', () => {});
    socket.on('close', () => {
      const wasConnected = this.connected;
      this.connecting = false;
      this.connected = false;
      this.socket = null;
      this.failAllPending(new RpcUnavailableError());
      if (wasConnected) console.error('Lost connection to the admin backend RPC socket - reconnecting...');
      this.scheduleReconnect();
    });
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.destroy();
    this.failAllPending(new Error('RPC client closed'));
  }

  get isConnected(): boolean {
    return this.connected;
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelayMs);
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, config.rpcReconnectMaxDelayMs);
  }

  private failAllPending(err: Error): void {
    for (const call of this.pending.values()) {
      clearTimeout(call.timeout);
      call.reject(err);
    }
    this.pending.clear();
  }

  private handleData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) continue;
      let res: ShareRpcResponse;
      try {
        res = JSON.parse(line) as ShareRpcResponse;
      } catch {
        continue;
      }
      const call = this.pending.get(res.id);
      if (!call) continue;
      this.pending.delete(res.id);
      clearTimeout(call.timeout);
      if ('error' in res) call.reject(new Error(res.error));
      else call.resolve(res.result);
    }
  }

  private call<M extends ShareRpcMethodName>(method: M, params: ShareRpcMethods[M]['params']): Promise<ShareRpcMethods[M]['result']> {
    if (!this.connected || !this.socket) {
      return Promise.reject(new RpcUnavailableError());
    }
    const id = this.nextId++;
    const req: ShareRpcRequest<M> = { id, method, params };
    const socket = this.socket;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcUnavailableError('The admin backend did not respond in time.'));
      }, config.rpcRequestTimeoutMs);
      this.pending.set(id, { resolve: resolve as (r: unknown) => void, reject, timeout });
      socket.write(`${JSON.stringify(req)}\n`);
    });
  }

  unlockShare(params: UnlockShareParams): Promise<UnlockShareResult> {
    return this.call('unlockShare', params);
  }

  recordDownload(params: RecordDownloadParams): Promise<{ ok: true }> {
    return this.call('recordDownload', params);
  }

  recordEdit(params: RecordEditParams): Promise<{ ok: true }> {
    return this.call('recordEdit', params);
  }

  reserveUploadBytes(params: ReserveUploadBytesParams): Promise<ReserveUploadBytesResult> {
    return this.call('reserveUploadBytes', params);
  }

  trueUpUploadBytes(params: TrueUpUploadBytesParams): Promise<{ ok: true }> {
    return this.call('trueUpUploadBytes', params);
  }

  // Fire-and-forget - an access-log write failing (or the RPC being briefly unavailable) should
  // never block or fail the real operation it's just a record of.
  logAccess(params: LogAccessParams): void {
    this.call('logAccess', params).catch(() => {});
  }

  /**
   * Re-validated on each substantive request, subject to the short in-memory cache described in
   * config.ts's resolveShareCacheTtlMs doc comment - explicitly NOT used by the upload quota
   * calls (reserveUploadBytes/trueUpUploadBytes), which always hit the RPC socket fresh.
   */
  async resolveShareForOp(shareId: string, opts?: { bypassCache?: boolean }): Promise<ResolveShareForOpResult> {
    if (!opts?.bypassCache) {
      const cached = this.resolveCache.get(shareId);
      if (cached && cached.expiresAt > Date.now()) return cached.result;
    }
    const result = await this.call('resolveShareForOp', { shareId });
    this.resolveCache.set(shareId, { result, expiresAt: Date.now() + config.resolveShareCacheTtlMs });
    return result;
  }

  /** Called right after a revoke-relevant mutation this process itself becomes aware of (there
   *  currently is none - revocation always happens on the admin side) - kept as a documented
   *  escape hatch in case a future v1.1 need arises, rather than something any current call site
   *  invokes. */
  invalidateResolveCache(shareId: string): void {
    this.resolveCache.delete(shareId);
  }
}
