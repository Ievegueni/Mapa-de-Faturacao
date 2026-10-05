export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public issues?: { path: string; message: string }[]) {
    super(message);
  }
}

let accessToken: string | null = null;
export interface Session {
  accessToken: string;
  user: unknown;
}

let refreshing: Promise<Session | null> | null = null;
let onSessionExpired: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function setSessionExpiredHandler(fn: () => void) {
  onSessionExpired = fn;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body !== undefined && !(init.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(`/api${path}`, { ...init, headers, credentials: "include" });
}

/** Renova o access token com o cookie de refresh (um pedido de cada vez). */
export function refreshSession(): Promise<Session | null> {
  refreshing =
    refreshing ||
    fetch("/api/auth/refresh", { method: "POST", credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json()) as Session;
        accessToken = body.accessToken;
        return body;
      })
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
  return refreshing;
}

/** Pedido JSON à API (`/api` passa pelo proxy do Vite ou do Nginx). Renova a sessão uma vez em caso de 401. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await request(path, init);
  if (res.status === 401 && !path.startsWith("/auth/")) {
    if (await refreshSession()) res = await request(path, init);
    else onSessionExpired?.();
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, (body && body.message) || res.statusText, body?.code, body?.issues);
  }
  return body as T;
}

export const apiPost = <T>(path: string, data?: unknown) =>
  api<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });
export const apiPatch = <T>(path: string, data: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(data) });
export const apiPut = <T>(path: string, data: unknown) => api<T>(path, { method: "PUT", body: JSON.stringify(data) });
export const apiDelete = <T>(path: string) => api<T>(path, { method: "DELETE" });

/** Envio de ficheiro (multipart/form-data). */
export const apiUpload = <T>(path: string, form: FormData) => api<T>(path, { method: "POST", body: form });
