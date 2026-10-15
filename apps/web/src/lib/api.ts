export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export type Role = "owner" | "staff" | "student";

export interface Session {
  accessToken: string;
  expiresIn: number;
  role: Role;
  studioId: string;
  mustChangePassword: boolean;
}

// The short-lived access token lives only in memory. The long-lived refresh token is an HttpOnly
// cookie the page cannot read, so a script injected into the page cannot steal a lasting login.
let accessToken: string | null = null;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

async function send<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean }): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.auth && accessToken) headers.authorization = `Bearer ${accessToken}`;

  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "network");
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body (for example a proxy error page) is handled by the status code below.
  }
  if (!res.ok) {
    const code = (data as { error?: unknown } | null)?.error;
    throw new ApiError(res.status, typeof code === "string" ? code : "unknown");
  }
  return data as T;
}

// Several callers can ask for a new session at once (React runs effects twice in development, and a
// page can fire two requests together). The backend treats a refresh token used twice as theft and
// logs the user out everywhere, so concurrent callers must share a single request.
let refreshing: Promise<Session | null> | null = null;

export function refreshSession(): Promise<Session | null> {
  refreshing ??= send<Session>("/auth/refresh", { method: "POST" })
    .then((session) => {
      accessToken = session.accessToken;
      return session;
    })
    .catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export const publicRequest = <T>(path: string, method: string, body?: unknown) => send<T>(path, { method, body });

// Calls an endpoint that needs a login. If the access token has expired it gets a new one once and retries.
export async function authedRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  try {
    return await send<T>(path, { method, body, auth: true });
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err;
    const session = await refreshSession();
    if (!session) throw err;
    return send<T>(path, { method, body, auth: true });
  }
}
