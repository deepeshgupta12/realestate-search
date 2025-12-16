type Params = Record<string, string | number | boolean | null | undefined>;

const DEFAULT_BACKEND = "http://localhost:8000";
const DEFAULT_PREFIX = "/api/v1";

export function buildUrl(path: string, params?: Params): string {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL || DEFAULT_BACKEND;
  const prefix = process.env.NEXT_PUBLIC_API_PREFIX || DEFAULT_PREFIX;

  let p = path.startsWith("/") ? path : `/${path}`;

  // If caller passes "/search/xyz", auto-prefix to "/api/v1/search/xyz"
  if (!p.startsWith(prefix) && !p.startsWith("/health") && !p.startsWith("/openapi")) {
    p = `${prefix}${p}`;
  }

  const u = new URL(p, base);

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === null || v === undefined) continue;
      u.searchParams.set(k, String(v));
    }
  }

  return u.toString();
}

async function readErr(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t || `${res.status} ${res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

export async function apiGet<T>(path: string, params?: Params, init?: RequestInit): Promise<T> {
  const url = buildUrl(path, params);
  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
    ...init,
    headers: {
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await readErr(res)}`);
  return (await res.json()) as T;
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  params?: Params,
  init?: RequestInit
): Promise<T> {
  const url = buildUrl(path, params);
  const res = await fetch(url, {
    method: "POST",
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await readErr(res)}`);
  return (await res.json()) as T;
}
