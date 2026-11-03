/** URL da API. Vazia em dev (proxy do Vite); em produção vem de VITE_API_URL (o Render pode passar só o host). */
export const API_BASE = (() => {
  const raw = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").trim().replace(/\/$/, "");
  if (!raw) return "";
  return /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
})();
const BASE = API_BASE;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

// Access token só em memória (nunca em localStorage). O refresh token fica em cookie HttpOnly.
let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;
let refreshing: Promise<string | null> | null = null;

export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
export const getAccessToken = () => accessToken;
export const setSessionLostHandler = (fn: () => void) => {
  onSessionLost = fn;
};

async function parseError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => null);
  const err = body?.error;
  return new ApiError(res.status, err?.code ?? "HTTP_ERROR", err?.message ?? `Erro ${res.status}`, err?.details);
}

/** Uma única renovação por vez, mesmo com várias requisições recebendo 401 juntas. */
export function refreshSession(): Promise<string | null> {
  refreshing ??= fetch(`${BASE}/api/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "x-lh-client": "web" },
  })
    .then(async (res) => {
      if (!res.ok) return null;
      const { accessToken: t } = (await res.json()) as { accessToken: string };
      accessToken = t;
      return t;
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

interface Options extends Omit<RequestInit, "body"> {
  body?: unknown;
  timeoutMs?: number;
}

export async function api<T>(path: string, opts: Options = {}, retried = false): Promise<T> {
  const { body, timeoutMs = 20_000, headers, ...rest } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...rest,
      credentials: "include",
      signal: rest.signal ?? controller.signal,
      headers: {
        "x-lh-client": "web",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new ApiError(0, "TIMEOUT", "O servidor demorou para responder.");
    throw new ApiError(0, "NETWORK", "Sem conexão com o servidor.");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 && !retried && !path.startsWith("/api/auth/login") && !path.startsWith("/api/auth/register")) {
    const token = await refreshSession();
    if (token) return api<T>(path, opts, true);
    accessToken = null;
    onSessionLost?.();
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
