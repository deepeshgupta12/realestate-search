import type { SuggestResponse, ResolveResponse, SearchResponse } from "@/lib/types";

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000/api/v1";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export function suggest(q: string, cityId?: string, limit = 10): Promise<SuggestResponse> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (cityId) params.set("city_id", cityId);
  return getJson(`${BASE}/search/suggest?${params.toString()}`);
}

export function resolve(q: string, cityId?: string): Promise<ResolveResponse> {
  const params = new URLSearchParams({ q });
  if (cityId) params.set("city_id", cityId);
  return getJson(`${BASE}/search/resolve?${params.toString()}`);
}

export function search(q: string, cityId?: string, limit = 20): Promise<SearchResponse> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (cityId) params.set("city_id", cityId);
  return getJson(`${BASE}/search?${params.toString()}`);
}
