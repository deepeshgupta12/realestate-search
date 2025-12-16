/**
 * Frontend API helper
 * - Always targets NEXT_PUBLIC_API_BASE (defaults to localhost:8000)
 * - Auto-prefixes relative paths with /api/v1
 * - Exposes buildUrl for places that need direct URLs
 */

export const API_PREFIX = "/api/v1";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000").replace(/\/+$/, "");
}

function ensureLeadingSlash(p: string): string {
  if (!p) return "/";
  return p.startsWith("/") ? p : `/${p}`;
}

function normalizePath(path: string): string {
  // absolute URL -> leave as-is
  if (/^https?:\/\//i.test(path)) return path;

  const p = ensureLeadingSlash(path);

  // already versioned or special endpoints
  if (p.startsWith(API_PREFIX + "/")) return p;
  if (p === API_PREFIX) return p;
  if (p === "/health" || p.startsWith("/health?")) return p;

  // otherwise prefix
  return `${API_PREFIX}${p}`;
}

export function buildUrl(
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>
): string {
  const normalized = normalizePath(path);

  // If normalized is still absolute, URL() will handle it fine.
  const u = new URL(normalized, apiBase());

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      u.searchParams.set(k, String(v));
    }
  }

  return u.toString();
}

async function readJsonOrText(res: Response) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  const t = await res.text();
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

export async function apiGet<T>(
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>
): Promise<T> {
  const url = buildUrl(path, params);
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await readJsonOrText(res);
    throw new Error(`GET ${new URL(url).pathname}${new URL(url).search} failed: ${res.status} ${JSON.stringify(body)}`);
  }

  return (await res.json()) as T;
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  params?: Record<string, string | number | boolean | null | undefined>
): Promise<T> {
  const url = buildUrl(path, params);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const b = await readJsonOrText(res);
    throw new Error(`POST ${new URL(url).pathname}${new URL(url).search} failed: ${res.status} ${JSON.stringify(b)}`);
  }

  return (await res.json()) as T;
}
