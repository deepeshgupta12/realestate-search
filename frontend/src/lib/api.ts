import type { ResolveResponse, SuggestResponse, TrendingResponse } from "@/lib/types";

const BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/+$/, "") || "http://localhost:8000";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function suggest(q: string, cityId?: string, limit = 10): Promise<SuggestResponse> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (cityId) params.set("city_id", cityId);
  return fetchJson<SuggestResponse>(`/api/v1/search/suggest?${params.toString()}`);
}

export async function search(q: string, cityId?: string, limit = 50): Promise<SuggestResponse> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (cityId) params.set("city_id", cityId);
  return fetchJson<SuggestResponse>(`/api/v1/search?${params.toString()}`);
}

export async function resolve(q: string, cityId?: string): Promise<ResolveResponse> {
  const params = new URLSearchParams({ q });
  if (cityId) params.set("city_id", cityId);
  return fetchJson<ResolveResponse>(`/api/v1/search/resolve?${params.toString()}`);
}

export async function trending(cityId?: string, limit = 10): Promise<TrendingResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cityId) params.set("city_id", cityId);
  return fetchJson<TrendingResponse>(`/api/v1/search/trending?${params.toString()}`);
}
