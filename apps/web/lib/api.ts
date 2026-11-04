export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Set by the auth provider. Privy access token, or a dev handle when running locally without Privy. */
let getToken: () => Promise<string | null> = async () => null;
let devUser: string | null = null;

export function configureAuth(opts: { getToken?: () => Promise<string | null>; devUser?: string | null }) {
  if (opts.getToken) getToken = opts.getToken;
  if (opts.devUser !== undefined) devUser = opts.devUser;
}

export async function authHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = {};
  const token = await getToken();
  if (token) h.authorization = `Bearer ${token}`;
  else if (devUser) h['x-dev-user'] = devUser;
  return h;
}

export async function socketAuth(): Promise<{ token?: string; devUser?: string }> {
  const token = await getToken();
  return token ? { token } : devUser ? { devUser } : {};
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_URL}/v1${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(await authHeaders()) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.message ?? body.error ?? `http_${res.status}`);
  }
  return res.json() as Promise<T>;
}
