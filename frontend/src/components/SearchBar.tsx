"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type RecentItem = { q: string; city_id?: string | null; context_url?: string | null; timestamp?: string };
type TrendingItem = { q: string; count: number; city_id?: string | null; context_url?: string | null };

type SuggestEntity = {
  id: string;
  entity_type: string;
  name: string;
  city?: string;
  city_id?: string;
  parent_name?: string;
  canonical_url?: string;
  score?: number;
  popularity_score?: number;
};

type SuggestResponseLite = { ok: boolean; items: SuggestEntity[] };
type TrendingResponse = { ok: boolean; items: TrendingItem[] };
type RecentResponse = { ok: boolean; items: RecentItem[] };

type ResolveResponse = {
  action: "redirect" | "serp" | "disambiguate";
  query: string;
  normalized_query: string;
  url: string | null;
  reason: string;
  match?: any;
  candidates?: any[] | null;
  debug?: any;
};

function getApiV1Base(): string {
  const v1 = (process.env.NEXT_PUBLIC_API_V1_BASE || "").trim();
  if (v1) return v1;
  const base = (process.env.NEXT_PUBLIC_API_BASE || "").trim();
  if (base) return `${base.replace(/\/+$/, "")}/api/v1`;
  return "/api/v1";
}

function spEncode(params: Record<string, string | null | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (!s) continue;
    usp.set(k, s);
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

function normalizeSpaces(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

function inferCitySlug(pathname: string): string | null {
  const p = (pathname || "/").split("?")[0].split("#")[0];
  const segs = p.split("/").filter(Boolean);
  if (!segs.length) return null;

  const first = segs[0].toLowerCase();

  // avoid catching reserved top-level app routes
  const reserved = new Set(["search", "disambiguate", "go", "api", "projects", "property-rates"]);
  if (reserved.has(first)) return null;

  return first;
}

function deriveContextFromPathname(pathname: string): { cityId: string | null; contextUrl: string } {
  const slug = inferCitySlug(pathname);
  if (!slug) return { cityId: null, contextUrl: "/" };
  return { cityId: `city_${slug}`, contextUrl: `/${slug}` };
}

function labelForEntity(e: SuggestEntity): string {
  const parts: string[] = [];
  const name = e.name || "";
  if (name) parts.push(name);
  const parent = (e.parent_name || "").trim();
  const city = (e.city || "").trim();
  if (parent && parent.toLowerCase() !== name.toLowerCase()) parts.push(parent);
  if (city && city.toLowerCase() !== name.toLowerCase() && city.toLowerCase() !== parent.toLowerCase()) parts.push(city);
  return parts.join(", ");
}

function groupKey(entity_type: string): "locations" | "projects" | "rate_pages" | "other" {
  const t = (entity_type || "").toLowerCase();
  if (t === "city" || t === "micromarket" || t === "locality" || t === "listing_page" || t === "locality_overview") {
    return "locations";
  }
  if (t === "project") return "projects";
  if (t === "rate_page") return "rate_pages";
  return "other";
}

export default function SearchBar() {
  const router = useRouter();
  const pathname = usePathname() || "/";

  const { cityId, contextUrl } = useMemo(() => deriveContextFromPathname(pathname), [pathname]);
  const apiBase = useMemo(() => getApiV1Base(), []);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [trending, setTrending] = useState<TrendingItem[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestEntity[]>([]);

  const [loadingZero, setLoadingZero] = useState(false);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isZeroState = normalizeSpaces(query).length === 0;

  async function apiGet<T>(path: string, params: Record<string, string | null | undefined>): Promise<T> {
    const url = `${apiBase}${path}${spEncode(params)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  }

  async function apiPost(path: string, payload: any): Promise<void> {
    const url = `${apiBase}${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  }

  async function fetchZeroState() {
    setLoadingZero(true);
    setErrorMsg(null);
    try {
      const [rec, trend] = await Promise.all([
        apiGet<RecentResponse>("/events/recent", { context_url: contextUrl, city_id: cityId, limit: "8" }),
        apiGet<TrendingResponse>("/events/trending", { context_url: contextUrl, city_id: cityId, limit: "6", window_days: "7" }),
      ]);
      setRecent(rec.items || []);
      setTrending(trend.items || []);
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed to load recent/trending");
      setRecent([]);
      setTrending([]);
    } finally {
      setLoadingZero(false);
    }
  }

  async function fetchSuggest(q: string) {
    setLoadingSuggest(true);
    setErrorMsg(null);
    try {
      const data = await apiGet<SuggestResponseLite>("/search/suggest", { q, city_id: cityId, limit: "10" });
      setSuggestions(data.items || []);
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed to load suggestions");
      setSuggestions([]);
    } finally {
      setLoadingSuggest(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    if (isZeroState) {
      setSuggestions([]);
      fetchZeroState();
      return;
    }

    const q = normalizeSpaces(query);
    if (!q) return;

    const t = setTimeout(() => {
      fetchSuggest(q);
    }, 150);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open, cityId, contextUrl, isZeroState]);

  // close on outside click
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  async function persistSearch(q: string) {
    try {
      await apiPost("/events/search", {
        query_id: `qid_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        raw_query: q,
        normalized_query: q,
        city_id: cityId,
        context_url: contextUrl,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // do not block UX
    }
  }

  function navigateToGo(q: string) {
    router.push(`/go${spEncode({ q, city_id: cityId, context_url: contextUrl })}`);
  }

  async function resolveAndGo(q: string) {
    const qq = normalizeSpaces(q);
    if (!qq) return;

    await persistSearch(qq);

    let rr: ResolveResponse | null = null;
    try {
      rr = await apiGet<ResolveResponse>("/search/resolve", { q: qq, city_id: cityId, context_url: contextUrl });
    } catch {
      rr = null;
    }

    if (!rr || !rr.url) {
      router.push(`/search${spEncode({ q: qq, city_id: cityId, context_url: contextUrl })}`);
      return;
    }

    if (rr.action === "disambiguate") {
      router.push(`/disambiguate${spEncode({ q: qq, city_id: cityId, context_url: contextUrl })}`);
      return;
    }

    // redirect or serp
    router.push(rr.url);
  }

  async function handleEnter() {
    setOpen(false);
    await resolveAndGo(query);
  }

  async function handlePickRecent(item: RecentItem) {
    const q = normalizeSpaces(item.q);
    if (!q) return;
    setQuery(q);
    setOpen(false);
    await resolveAndGo(q);
  }

  async function handlePickTrending(item: TrendingItem) {
    const q = normalizeSpaces(item.q);
    if (!q) return;
    setQuery(q);
    setOpen(false);
    await resolveAndGo(q);
  }

  async function handlePickSuggestion(s: SuggestEntity) {
    const q = normalizeSpaces(query);
    setOpen(false);

    // If user typed query, still record it (keeps "Recent" meaningful)
    if (q) await persistSearch(q);

    // Navigate by entity canonical_url if present; otherwise fall back to go/resolve
    const url = (s.canonical_url || "").trim();
    if (url) {
      router.push(url);
      return;
    }

    if (q) {
      navigateToGo(q);
      return;
    }

    router.push("/");
  }

  const grouped = useMemo(() => {
    const out: Record<string, SuggestEntity[]> = { locations: [], projects: [], rate_pages: [], other: [] };
    for (const s of suggestions) out[groupKey(s.entity_type)].push(s);
    return out;
  }, [suggestions]);

  function renderZeroState() {
    return (
      <div style={{ padding: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>Recent Searches</div>
        {loadingZero ? (
          <div style={{ fontSize: 14, opacity: 0.75 }}>Loading…</div>
        ) : recent.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {recent.map((it, idx) => (
              <button
                key={`${it.q}-${idx}`}
                onClick={() => handlePickRecent(it)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "1px solid rgba(0,0,0,0.08)",
                  borderRadius: 10,
                  background: "white",
                  cursor: "pointer",
                }}
              >
                {it.q}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 14, opacity: 0.75 }}>No recent searches yet.</div>
        )}

        <div style={{ height: 14 }} />

        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>Trending</div>
        {loadingZero ? (
          <div style={{ fontSize: 14, opacity: 0.75 }}>Loading…</div>
        ) : trending.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {trending.map((it, idx) => (
              <button
                key={`${it.q}-${idx}`}
                onClick={() => handlePickTrending(it)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "1px solid rgba(0,0,0,0.08)",
                  borderRadius: 10,
                  background: "white",
                  cursor: "pointer",
                }}
              >
                <span>{it.q}</span>
                <span style={{ fontSize: 12, opacity: 0.6 }}>{it.count}</span>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 14, opacity: 0.75 }}>No trending data yet.</div>
        )}
      </div>
    );
  }

  function renderSuggestions() {
    const q = normalizeSpaces(query);

    const sections: Array<{ title: string; items: SuggestEntity[] }> = [];
    if (grouped.locations.length) sections.push({ title: "Locations", items: grouped.locations });
    if (grouped.projects.length) sections.push({ title: "Projects", items: grouped.projects });
    if (grouped.rate_pages.length) sections.push({ title: "Pages", items: grouped.rate_pages });
    if (grouped.other.length) sections.push({ title: "Other", items: grouped.other });

    return (
      <div style={{ padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Suggestions</div>
          {loadingSuggest ? <div style={{ fontSize: 12, opacity: 0.7 }}>Loading…</div> : null}
        </div>

        {sections.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {sections.map((sec) => (
              <div key={sec.title}>
                <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 6 }}>{sec.title}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {sec.items.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => handlePickSuggestion(s)}
                      style={{
                        textAlign: "left",
                        padding: "10px 12px",
                        border: "1px solid rgba(0,0,0,0.08)",
                        borderRadius: 10,
                        background: "white",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{s.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{labelForEntity(s)}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <button
              onClick={() => resolveAndGo(q)}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                border: "1px solid rgba(0,0,0,0.12)",
                borderRadius: 10,
                background: "white",
                cursor: "pointer",
              }}
            >
              Search for “{q}”
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 14, opacity: 0.75 }}>
            No suggestions.{" "}
            <button onClick={() => resolveAndGo(q)} style={{ textDecoration: "underline", cursor: "pointer", background: "transparent", border: "none", padding: 0 }}>
              Search for “{q}”
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} style={{ width: "100%", maxWidth: 760 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleEnter();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            }
          }}
          placeholder="Search city, locality, project, builder…"
          style={{
            flex: 1,
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.18)",
            outline: "none",
            fontSize: 16,
          }}
        />

        <button
          onClick={() => handleEnter()}
          style={{
            padding: "12px 16px",
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.18)",
            background: "white",
            cursor: "pointer",
            fontSize: 16,
          }}
        >
          Search
        </button>
      </div>

      {open ? (
        <div
          style={{
            marginTop: 10,
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 14,
            background: "white",
            boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
            overflow: "hidden",
          }}
        >
          {errorMsg ? (
            <div style={{ padding: 12, color: "#b00020" }}>{errorMsg}</div>
          ) : isZeroState ? (
            renderZeroState()
          ) : (
            renderSuggestions()
          )}
        </div>
      ) : null}
    </div>
  );
}
