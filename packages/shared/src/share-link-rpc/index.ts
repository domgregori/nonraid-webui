/**
 * TypeScript request/response shapes for the share-link RPC protocol -
 * types only, no runtime logic, so the admin backend's rpcServer.ts and
 * share-server's shareLinkRpcClient.ts can't silently drift out of shape.
 *
 * Wire framing: newline-delimited JSON over the Unix domain socket at
 * config.shareRpcSocketPath (see backend/src/shareLinks/rpcServer.ts) -
 * consistent with the NDJSON convention already used elsewhere in this
 * codebase (POST /browse/bulk, POST /browse/search).
 *
 * This is the entire public surface between the two processes - share-server
 * has no other way to reach the admin backend, and no other RPC method
 * exists. Deliberately narrow: each method operates on one already-identified
 * share at a time, never returns the whole share_link table, and never
 * carries password_hash across the wire (unlockShare verifies the password
 * internally and returns only the operational fields share-server needs).
 */

export type ShareMode = 'read-only' | 'upload-only' | 'editable';

export interface UnlockShareParams {
  tokenHash: string;
  password?: string;
}

// Deliberate small addition over the plan's original binary {ok:false}|{ok:true,...} sketch: a
// public "what is this link" landing page (GET /api/shares/:token on share-server) needs to show
// a share's label/mode and whether a password is needed *before* a password has been supplied, so
// the unlock form can render something more useful than a blind text box - see the spec's own
// documented `GET /api/shares/:token -> { label, mode, requiresPassword }` contract, which the
// original literal RPC signature had no way to satisfy. `reason` distinguishes "this token is
// valid but needs a password" (safe to reveal label/mode for) from every other failure - an
// unknown/revoked/expired token, or a wrong password actively submitted - which reveals nothing
// at all, not even whether the token itself exists. rootPath/quota/allowDelete - everything
// operationally sensitive - still requires a genuine successful unlock either way.
export type UnlockShareResult =
  | { ok: false; reason: 'not_found' | 'wrong_password' }
  | { ok: false; reason: 'password_required'; label: string | null; mode: ShareMode }
  | {
      ok: true;
      shareId: string;
      mode: ShareMode;
      allowDelete: boolean;
      rootPath: string;
      label: string | null;
      uploadQuotaBytes: number | null;
      maxFileSizeBytes: number | null;
      uploadUsedBytes: number;
      expiresAt: number | null;
    };

export interface ResolveShareForOpParams {
  shareId: string;
}

// Re-validated on each substantive request (subject to share-server's own
// short-lived in-memory cache - see share-server/src/shareLinkRpcClient.ts)
// so a revocation/expiry takes effect promptly without re-checking the
// password every time.
export type ResolveShareForOpResult =
  | { ok: false }
  | {
      ok: true;
      mode: ShareMode;
      allowDelete: boolean;
      rootPath: string;
      revoked: false;
      expired: false;
      uploadQuotaBytes: number | null;
      maxFileSizeBytes: number | null;
      uploadUsedBytes: number;
    };

export interface RecordDownloadParams {
  shareId: string;
}
export type RecordDownloadResult = { ok: true };

export interface RecordEditParams {
  shareId: string;
  path: string;
}
export type RecordEditResult = { ok: true };

export interface ReserveUploadBytesParams {
  shareId: string;
  declaredBytes: number;
}
// false = the reservation would exceed upload_quota_bytes - caller must reject the upload (413)
// without writing anything. Never cached - always a fresh round trip (mutating + must-be-consistent).
export type ReserveUploadBytesResult = { ok: boolean };

export interface TrueUpUploadBytesParams {
  shareId: string;
  // Positive: the upload wrote more than the declared reservation covered (rare - a chunked
  // request whose real size exceeded Content-Length). Negative: the upload wrote less (aborted
  // mid-stream, or the declared size overestimated) and the reservation must be given back.
  deltaBytes: number;
}
export type TrueUpUploadBytesResult = { ok: true };

export type AccessLogKind = 'list' | 'download' | 'view' | 'upload' | 'edit' | 'unlock';

export interface LogAccessParams {
  shareId: string;
  kind: AccessLogKind;
  ip?: string;
  detail?: string;
}
export type LogAccessResult = { ok: true };

/** Typed method map - the single source of truth both the RPC server's dispatch table and the
 *  client's call signature are built from, so adding/removing a method can't leave the two sides
 *  silently out of sync. */
export interface ShareRpcMethods {
  unlockShare: { params: UnlockShareParams; result: UnlockShareResult };
  resolveShareForOp: { params: ResolveShareForOpParams; result: ResolveShareForOpResult };
  recordDownload: { params: RecordDownloadParams; result: RecordDownloadResult };
  recordEdit: { params: RecordEditParams; result: RecordEditResult };
  reserveUploadBytes: { params: ReserveUploadBytesParams; result: ReserveUploadBytesResult };
  trueUpUploadBytes: { params: TrueUpUploadBytesParams; result: TrueUpUploadBytesResult };
  logAccess: { params: LogAccessParams; result: LogAccessResult };
}

export type ShareRpcMethodName = keyof ShareRpcMethods;

export interface ShareRpcRequest<M extends ShareRpcMethodName = ShareRpcMethodName> {
  id: number;
  method: M;
  params: ShareRpcMethods[M]['params'];
}

export interface ShareRpcSuccessResponse<M extends ShareRpcMethodName = ShareRpcMethodName> {
  id: number;
  result: ShareRpcMethods[M]['result'];
}

export interface ShareRpcErrorResponse {
  id: number;
  error: string;
}

export type ShareRpcResponse<M extends ShareRpcMethodName = ShareRpcMethodName> = ShareRpcSuccessResponse<M> | ShareRpcErrorResponse;

export function isShareRpcErrorResponse(res: ShareRpcResponse): res is ShareRpcErrorResponse {
  return 'error' in res;
}
