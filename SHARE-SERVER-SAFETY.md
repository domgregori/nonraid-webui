# Precautions taken to keep sharing files safe

## Process & privilege isolation

- share-server: the process that actually receives internet traffic, runs as its own dedicated, unprivileged system account (no interactive shell, no home directory), never as root.
- Its systemd unit sets NoNewPrivileges=true and PrivateTmp=true, and it can't chown uploaded files to the array-data uid the way the admin backend can (that needs root), uploads just land owned by the unprivileged account.

## The database boundary

- share-server has zero filesystem access to share_link.db. The admin backend is its sole owner. share-server talks to it only through a narrow Unix-socket RPC server that reveals one already-identified share at a time and never sends the password hash across the wire. 
- A fully compromised share-server process still can't read another share's path, list the whole share table, or forge a password check, that logic only exists inside the admin backend.

## Path sandboxing

- Every path a share resolves goes through the same traversal/symlink-escape sandbox (path-sandbox) the admin's own file browser uses — a share's root can never be tricked into reaching outside /mnt.

## The token and password model

- The link token itself is 192 bits of random Bytes — its own entropy, not any hashing scheme, is what resists guessing/fuzzing.
- Two different hashing choices for two different exposure profiles: the token is looked up via plain SHA-256, while an optional share password is hashed with scrypt + a random salt + timingSafeEqual comparison. Password verification only ever happens inside the admin backend, never in share-server.

## Unlock sessions

- A successful unlock sets an httpOnly cookie named su_<shareId>, signed with share-server's own independent secret. It's self-contained, carries the share id, the token hash it was issued for, and its own expiry. So it's checked against the current token hash on every request and can't outlive its own TTL, with no server-side session store needed at all.
- Unlock attempts are rate-limited per (real client IP, token) — and specifically per the real visitor IP from Cloudflare's Cf-Connecting-Ip header.

## Access-mode enforcement, server-side
- Three modes: read-only, upload-only (a true blind drop-box — it 404s on listing rather than 403ing, so it doesn't even confirm anything's there), and editable. Every mode boundary is re-checked on the actual route, but saving an edit is enforced separately on the write route regardless of what the client sends.

## Upload safety
- Cumulative quota is reserved atomically in one SQL statement before any bytes are written and refuses to reserve at all against an already-revoked/expired share. The per-file cap is enforced as a real streaming ceiling, not a spoofable Content-Length check.

## Inline media/PDF viewing — a deliberate allowlist
- Content-Type for the inline viewer is never trusted from the file's extension or sniffed from its bytes. It is set from a hardcoded allowlist (image/video/audio/PDF) that explicitly excludes SVG/HTML/XML, plus X-Content-Type-Options: nosniff, specifically so a maliciously named or uploaded file can never get served back as same-origin HTML.

## Transport & audit
- The only way any of this reaches the internet at all is through a Cloudflare Tunnel — Cloudflare's edge terminates TLS, and the tunnel token lives in its own 0600 file.
- Every list/download/upload/edit/unlock/view is logged per-share with timestamp and IP, so there's a real audit trail per link.