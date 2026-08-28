// Thin wrapper over the backend's REST API (see backend/API.md) - every route is mounted under
// `/api`, errors come back as `{ error: string }` (backend/httpError.ts's convention), and every
// route but /health and /auth/* requires either a session cookie (browser) or, as of this CLI,
// `Authorization: Bearer <token>` (see backend/src/auth/service.ts's isAuthenticated).
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  host: string; // e.g. "https://nonraid.lan" - protocol + host[:port], no trailing slash, no /api
  token?: string;
  // Skips TLS certificate verification for the whole process - this app's own TLS feature
  // (backend/src/tls) issues self-signed certs by default (see the TLS section of API.md), which a
  // plain `fetch` call would otherwise reject. Implemented as the same NODE_TLS_REJECT_UNAUTHORIZED
  // escape hatch curl's `-k`/most CLIs use, not a per-request dispatcher - Node's global `fetch`
  // has no first-class per-call TLS-verification override, and this is a short-lived CLI process,
  // not a long-running server where a process-wide relaxation would be a bigger concern.
  insecure?: boolean;
}

export class ApiClient {
  private baseUrl: string;
  private token: string | undefined;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.host.replace(/\/+$/, '');
    this.token = opts.token;
    if (opts.insecure) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      throw new ApiError(res.status, text || res.statusText);
    }

    if (!res.ok) {
      const message = typeof (parsed as { error?: unknown })?.error === 'string' ? (parsed as { error: string }).error : res.statusText;
      throw new ApiError(res.status, message);
    }
    return parsed as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body ?? {});
  }
  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body ?? {});
  }
  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}
