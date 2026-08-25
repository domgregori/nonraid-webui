# backend/src/tls/

## Responsibility
HTTPS/TLS lifecycle: persist TLS metadata, generate self-signed certificates, validate imported cert/key pairs, and let the server flip between HTTP and HTTPS (via a self-restart).

## Design
- `store.ts` owns `tls.json` (same cache/serialized-write-queue/atomic-rename pattern as auth). The record is metadata only — paths, source (`self-signed`/`imported`), CN, SANs, dates — never key material; the PEM files live under `config.tlsCertDir`. `setCert()` deliberately preserves the current `enabled` value so regenerating/importing never silently flips TLS on or off; enabling is a separate `setEnabled()` call (409 if no cert exists).
- `certGen.ts` shells out to `openssl req -x509` (via `runSudoMaybe`) for an RSA-2048 self-signed cert; validates the CN and each DNS:/IP: SAN entry up front, chmod 600 the key, and re-parses the result through `certInspect` to fill `issuedAt`/`expiresAt`.
- `certInspect.ts` parses `openssl x509 -noout -subject/-issuer/-startdate/-enddate`; SANs are queried separately so a cert without the extension doesn't fail parsing. `checkKeyMatchesCert` compares each side's derived public-key PEM (works uniformly for RSA/EC/Ed25519 and rejects passphrase-protected keys for free).
- Route layer (`routes/tls.ts`) handles the import flow: multer stages the upload to `os.tmpdir()`, an in-memory `stagedTlsImports` map (30-min lazy sweep) holds the token, and `/commit` re-validates the live files before copying them into place. Both enable/disable respond first, then self-restart by exiting non-zero.

## Flow
`POST /tls/self-signed` → `generateSelfSigned` → `setCert`. `POST /tls/import/preview` (multipart cert+key) → parse + validate + stage → token. `POST /tls/import/commit` → re-validate → copy to `tlsCertDir` → `setCert`. `POST /tls/enable|disable` → `setEnabled` → reissue session cookie (disable flips `config.cookieSecure` first so the browser drops the old Secure cookie) → respond → exit. At boot `index.ts` reads `tls.json`; if enabled it creates the `https` server, else falls back to plain HTTP.

## Integration
Consumed by `routes/tls.ts` and by `index.ts` for server creation. Depends on `auth` (reissueSession, requestOrigin), `activity`, `config` (tlsCertDir, opensslBin, tlsSelfSignedDays), and `system/procUtil`.
