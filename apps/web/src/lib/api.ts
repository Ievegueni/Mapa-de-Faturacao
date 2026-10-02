export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Pedido JSON à API (`/api` passa pelo proxy do Vite ou do Nginx). */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (body && body.message) || res.statusText);
  return body as T;
}
