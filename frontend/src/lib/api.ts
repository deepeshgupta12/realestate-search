type Query = Record<string, string | number | boolean | null | undefined>;

function baseUrl(): string {
  // Avoid localhost -> IPv6 issues in Node fetch; prefer 127.0.0.1 by default.
  return (
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    "http://127.0.0.1:8000"
  );
}

const API_PREFIX = process.env.NEXT_PUBLIC_API_PREFIX ?? "/api/v1";

function normalizeApiPath(path: string): string {
  // allow absolute URLs unchanged
  if (/^https?:\/\//i.test(path)) return path;

  // ensure leading slash
  const p = path.startsWith("/") ? path : `/${path}`;

  // already prefixed or already /api/...
  if (p === API_PREFIX || p.startsWith(`${API_PREFIX}/`)) return p;
  if (p.startsWith("/api/")) return p;

  // default: prefix it
  return `${API_PREFIX}${p}`;
}

function buildUrl(path: string, query?: Query): string {
  const url = new URL(normalizeApiPath(path), baseUrl());
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function apiGet<T>(path: string, query?: Query): Promise<T> {
  const res = await fetch(buildUrl(path, query), { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}