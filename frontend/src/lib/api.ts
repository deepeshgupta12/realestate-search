// frontend/src/lib/api.ts
type Query = Record<string, string | number | boolean | null | undefined>;

function baseUrl(): string {
  // Prefer 127.0.0.1 to avoid IPv6 localhost issues in Node fetch.
  return (
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    "http://127.0.0.1:8000"
  );
}

function ensureLeadingSlash(p: string): string {
  if (!p) return "/";
  return p.startsWith("/") ? p : `/${p}`;
}

/**
 * Auto-prefix API paths so FE can call:
 *   /search/..., /events/..., /admin/...
 * and we convert it to:
 *   /api/v1/search/..., /api/v1/events/..., /api/v1/admin/...
 */
function normalizeApiPath(path: string): string {
  // If already absolute URL, do nothing
  if (/^https?:\/\//i.test(path)) return path;

  const p = ensureLeadingSlash(path);

  // Already versioned
  if (p.startsWith("/api/")) return p;

  // Only prefix API routes we own
  if (p.startsWith("/search") || p.startsWith("/events") || p.startsWith("/admin")) {
    return `/api/v1${p}`;
  }

  // Leave other paths (if any) untouched
  return p;
}

export function buildUrl(path: string, query?: Query): string {
  const normalized = normalizeApiPath(path);
  const url = new URL(normalized, baseUrl());

  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === null || v === undefined) continue;
      const s = String(v).trim();
      if (!s) continue;
      url.searchParams.set(k, s);
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

export async function apiPost<T>(
  path: string,
  body: unknown,
  query?: Query
): Promise<T> {
  const res = await fetch(buildUrl(path, query), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}