export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    window.dispatchEvent(new Event('unauthenticated'));
    throw new ApiError('Nicht angemeldet', 401);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as any).error || `Fehler ${res.status}`, res.status);
  return data as T;
}

export const api = {
  get: <T = any>(u: string) => req<T>('GET', u),
  post: <T = any>(u: string, b: unknown = {}) => req<T>('POST', u, b),
  put: <T = any>(u: string, b: unknown) => req<T>('PUT', u, b),
  del: <T = any>(u: string) => req<T>('DELETE', u),
};
