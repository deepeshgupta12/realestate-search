// frontend/src/lib/api.ts
type Query = Record<string, string | number | boolean | null | undefined>;

function baseUrl() {
  // Use env if you want later; keep default stable for local.
  return process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";
}

function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === null || v === undefined) continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

export async function apiGet<T>(path: string, query?: Query): Promise<T> {
  const url = baseUrl() + withQuery(path, query);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const url = baseUrl() + path;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

// Non-blocking helper (we never want events to break UX)
export function fireAndForget(p: Promise<unknown>) {
  p.catch(() => {});
}