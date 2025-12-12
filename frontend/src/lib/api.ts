export type Query = Record<
  string,
  string | number | boolean | null | undefined
>;

function getBaseUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    "http://127.0.0.1:8000";

  // ensure absolute URL
  if (!/^https?:\/\//i.test(base)) return `http://${base}`;
  return base;
}

export function buildUrl(path: string, query?: Query): string {
  const base = getBaseUrl();
  const url = new URL(path, base);

  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function apiGet<T>(path: string, query?: Query): Promise<T> {
  const url = buildUrl(path, query);

  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (err: any) {
    // This is the ECONNREFUSED case
    const msg = err?.message ? String(err.message) : String(err);
    throw new Error(`fetch failed for ${url}: ${msg}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }

  return (await res.json()) as T;
}
