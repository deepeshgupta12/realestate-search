type Query = Record<string, string | number | boolean | null | undefined>;

function baseUrl(): string {
  // Avoid localhost -> IPv6 issues in Node fetch; prefer 127.0.0.1 by default.
  return (
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    "http://127.0.0.1:8000"
  );
}

export function buildUrl(path: string, query?: Query): string {
  const url = new URL(path, baseUrl());
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