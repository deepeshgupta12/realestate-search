"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

/**
 * SearchBar (v1.8d)
 * - Recent searches (works with BE payloads that contain either {raw_query, query_id} OR {q})
 * - Autocomplete (prefers /search/suggest; falls back to /search/autocomplete if present)
 * - Enter triggers /search/resolve and client-side redirect
 */

type ResolveMatch = {
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

type ResolveResponse = {
  action: "redirect" | "serp" | "disambiguate";
  query: string;
  normalized_query: string;
  url: string;
  match: ResolveMatch | null;
  candidates: ResolveMatch[] | null;
  reason: string;
  debug: any;
};

type SuggestItem = {
  id: string;
  entity_type: string;
  name: string;
  city?: string;
  city_id?: string;
  canonical_url?: string;
  score?: number;
};

type SuggestResponseV1 = {
  items?: SuggestItem[];
};

type SuggestResponseV2 = {
  ok?: boolean;
  groups?: {
    locations?: SuggestItem[];
    projects?: SuggestItem[];
    pages?: SuggestItem[];
  };
};

type RecentItemV1 = {
  query_id?: string;
  raw_query?: string;
  normalized_query?: string;
  city_id: string | null;
  context_url: string;
  timestamp: string;
};

type RecentItemV2 = {
  q?: string;
  city_id: string | null;
  context_url: string;
  timestamp: string;
};

type RecentResponse = {
  ok?: boolean;
  items?: Array<RecentItemV1 & RecentItemV2>;
};

function normalizeBase(raw: string | undefined, fallback: string) {
  let v = (raw ?? "").trim();
  if (!v) v = fallback;

  // handle accidental "NEXT_PUBLIC_API_V1_BASE=http://..."
  if (v.includes("NEXT_PUBLIC_API_V1_BASE=")) {
    v = v.split("NEXT_PUBLIC_API_V1_BASE=").pop() || fallback;
  }
  if (v.includes("\n")) {
    v = v
      .split("\n")
      .map((s) => s.trim())
      .find(Boolean) || v;
  }

  return v.replace(/\/+$/, "");
}

function pickCitySlug(pathname: string) {
  const parts = pathname.split("?")[0].split("/").filter(Boolean);
  return parts.length ? parts[0] : null;
}

function citySlugToId(citySlug: string | null): string | null {
  if (!citySlug) return null;
  const m: Record<string, string> = {
    pune: "city_pune",
    noida: "city_noida",
  };
  return m[citySlug.toLowerCase()] || null;
}

function safeString(v: any) {
  return typeof v === "string" ? v : "";
}

async function apiGetJson<T>(
  base: string,
  path: string,
  params?: Record<string, string | number | null | undefined>,
) {
  const usp = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([k, v]) => {
    if (v === null || v === undefined || v === "") return;
    usp.set(k, String(v));
  });

  const url = `${base}${path}${usp.toString() ? `?${usp.toString()}` : ""}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

async function apiPostJson<T>(base: string, path: string, body: Record<string, any>) {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

function parseSuggestItems(data: any): SuggestItem[] {
  // supports:
  // - { items: [...] }
  // - { ok: true, groups: { locations/projects/pages: [...] } }
  if (Array.isArray(data?.items)) return data.items as SuggestItem[];
  const groups = data?.groups;
  if (groups && typeof groups === "object") {
    const loc = Array.isArray(groups.locations) ? groups.locations : [];
    const proj = Array.isArray(groups.projects) ? groups.projects : [];
    const pages = Array.isArray(groups.pages) ? groups.pages : [];
    return [...loc, ...proj, ...pages] as SuggestItem[];
  }
  return [];
}

function getRecentLabel(it: any): string {
  const raw = safeString(it?.raw_query).trim();
  if (raw) return raw;

  const q = safeString(it?.q).trim();
  if (q) return q;

  const norm = safeString(it?.normalized_query).trim();
  if (norm) return norm;

  return "";
}

function getRecentKey(it: any, idx: number): string {
  const qid = safeString(it?.query_id);
  if (qid) return qid;
  const t = safeString(it?.timestamp);
  const q = getRecentLabel(it);
  return `${t || "t"}:${q || "q"}:${idx}`;
}

export default function SearchBar() {
  const router = useRouter();
  const pathname = usePathname();

  const citySlug = useMemo(() => pickCitySlug(pathname || "/"), [pathname]);
  const cityId = useMemo(() => citySlugToId(citySlug), [citySlug]);
  const contextUrl = useMemo(() => {
    // your BE expects a "context_url" like "/" or "/noida" etc.
    // For this MVP we keep only the first segment context: "/" or "/<city>"
    return citySlug ? `/${citySlug}` : "/";
  }, [citySlug]);

  const apiV1Base = useMemo(() => {
    // Prefer NEXT_PUBLIC_API_V1_BASE, else fall back to NEXT_PUBLIC_API_BASE + /api/v1, else hardcode local
    const rawV1 = (process.env.NEXT_PUBLIC_API_V1_BASE as string | undefined) ?? "";
    const rawBase = (process.env.NEXT_PUBLIC_API_BASE as string | undefined) ?? "";

    if (rawV1.trim()) return normalizeBase(rawV1, "http://localhost:8000/api/v1");
    if (rawBase.trim()) return normalizeBase(rawBase, "http://localhost:8000") + "/api/v1";
    return "http://localhost:8000/api/v1";
  }, []);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const [recent, setRecent] = useState<Array<any>>([]);
  const [recentErr, setRecentErr] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<SuggestItem[]>([]);
  const [suggestErr, setSuggestErr] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  async function loadRecent() {
    setRecentErr(null);
    try {
      const data = await apiGetJson<RecentResponse>(apiV1Base, "/events/recent", {
        context_url: contextUrl,
        limit: 8,
        // Only send city_id if you actually have one (prevents accidental "undefined")
        city_id: cityId,
      });

      const items = Array.isArray((data as any)?.items) ? (data as any).items : [];
      setRecent(items);
    } catch (e: any) {
      setRecent([]);
      setRecentErr(e?.message || "failed");
    }
  }

  async function loadSuggestions(q: string) {
    setSuggestErr(null);
    try {
      // Prefer /search/suggest (your BE has this)
      const data = await apiGetJson<SuggestResponseV1 & SuggestResponseV2>(apiV1Base, "/search/suggest", {
        q,
        limit: 20,
        city_id: cityId,
        context_url: contextUrl,
      });

      const items = parseSuggestItems(data);
      setSuggestions(items);
      return;
    } catch (e1: any) {
      // Fallback: older BE might have /search/autocomplete
      try {
        const data2 = await apiGetJson<SuggestResponseV1 & SuggestResponseV2>(apiV1Base, "/search/autocomplete", {
          q,
          limit: 20,
          city_id: cityId,
          context_url: contextUrl,
        });

        const items2 = parseSuggestItems(data2);
        setSuggestions(items2);
        return;
      } catch (e2: any) {
        setSuggestions([]);
        setSuggestErr(e2?.message || e1?.message || "failed");
      }
    }
  }

  async function persistSearch(q: string) {
    const raw = q.trim();
    if (!raw) return;

    const payload = {
      query_id: `qid_${Date.now()}`,
      raw_query: raw,
      normalized_query: raw.toLowerCase(),
      city_id: cityId ?? null,
      context_url: contextUrl,
      timestamp: new Date().toISOString(),
    };

    try {
      await apiPostJson(apiV1Base, "/events/search", payload);
    } catch {
      // non-fatal
    }
  }

  async function resolveAndRedirect(rawQ: string) {
    const q = rawQ.trim();
    if (!q) return;

    // persist first (so recent is written even if resolve/disambiguate)
    await persistSearch(q);

    // then resolve
    const data = await apiGetJson<ResolveResponse>(apiV1Base, "/search/resolve", {
      q,
      city_id: cityId,
      context_url: contextUrl,
    });

    if (data.action === "redirect") {
      router.push(data.url);
      return;
    }

    if (data.action === "disambiguate") {
      router.push(`/disambiguate?q=${encodeURIComponent(q)}&context_url=${encodeURIComponent(contextUrl)}`);
      return;
    }

    // serp fallback
    router.push(`/search?q=${encodeURIComponent(q)}&city_id=${encodeURIComponent(cityId ?? "")}&context_url=${encodeURIComponent(contextUrl)}`);
  }

  // When dropdown opens & query is empty-ish -> load recent
  useEffect(() => {
    if (!open) return;
    if (query.trim().length >= 2) return;

    let cancelled = false;
    (async () => {
      await loadRecent();
      if (cancelled) return;
    })();

    return () => {
      cancelled = true;
    };
    // IMPORTANT: depend on cityId (not city_id) to avoid ReferenceError
  }, [open, query, cityId, contextUrl, apiV1Base]);

  // When dropdown is open and query >=2 -> load suggestions
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSuggestErr(null);
      return;
    }

    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        await loadSuggestions(q);
      } finally {
        if (cancelled) return;
      }
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, query, cityId, contextUrl, apiV1Base]);

  const showRecent = open && query.trim().length < 2;
  const showSuggest = open && query.trim().length >= 2;

  return (
    <div style={{ width: "min(760px, 92vw)" }}>
      <div style={{ display: "flex", gap: 10 }}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={async (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setOpen(false);
              await resolveAndRedirect(query);
            }
            if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="Search city / locality / project..."
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(0,0,0,0.25)",
            color: "white",
            outline: "none",
          }}
        />
        <button
          onClick={async () => {
            setOpen(false);
            await resolveAndRedirect(query);
          }}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(255,255,255,0.08)",
            color: "white",
            cursor: "pointer",
          }}
        >
          Search
        </button>
      </div>

      {open && (
        <div
          style={{
            marginTop: 8,
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(0,0,0,0.35)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "10px 12px", fontSize: 12, opacity: 0.9, display: "flex", justifyContent: "space-between" }}>
            <div>
              <b>context:</b> {contextUrl}
            </div>
            <button
              onClick={() => {
                setQuery("");
                setSuggestions([]);
                setRecent([]);
                setRecentErr(null);
                setSuggestErr(null);
                inputRef.current?.focus();
              }}
              style={{
                border: "none",
                background: "transparent",
                color: "white",
                opacity: 0.9,
                cursor: "pointer",
                textDecoration: "underline",
                fontSize: 12,
              }}
            >
              Clear
            </button>
          </div>

          {showRecent && (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.10)" }}>
              <div style={{ padding: "10px 12px", fontSize: 12, opacity: 0.9 }}>
                <b>Recent searches</b>
              </div>

              {recentErr && (
                <div style={{ padding: "8px 12px", fontSize: 12, color: "salmon" }}>
                  GET /events/recent failed: {recentErr}
                </div>
              )}

              {(!recent || recent.length === 0) && !recentErr && (
                <div style={{ padding: "8px 12px", fontSize: 12, opacity: 0.8 }}>No recent searches yet</div>
              )}

              {Array.isArray(recent) &&
                recent.map((r: any, idx: number) => {
                  const label = getRecentLabel(r);
                  if (!label) return null;

                  return (
                    <div
                      key={getRecentKey(r, idx)}
                      style={{
                        padding: "10px 12px",
                        borderTop: "1px solid rgba(255,255,255,0.08)",
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        alignItems: "center",
                      }}
                    >
                      <button
                        onClick={async () => {
                          setQuery(label);
                          setOpen(false);
                          await resolveAndRedirect(label);
                        }}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "white",
                          cursor: "pointer",
                          textAlign: "left",
                          padding: 0,
                        }}
                        title="Run this search"
                      >
                        {label}
                      </button>

                      <Link
                        href={`/search?q=${encodeURIComponent(label)}&city_id=${encodeURIComponent(cityId ?? "")}&context_url=${encodeURIComponent(
                          contextUrl,
                        )}`}
                        onClick={() => setOpen(false)}
                        style={{ fontSize: 12, opacity: 0.9, textDecoration: "underline" }}
                      >
                        Go to SERP
                      </Link>
                    </div>
                  );
                })}

              <div style={{ padding: "10px 12px", fontSize: 12, opacity: 0.75 }}>
                <div>
                  <b>API:</b> {apiV1Base}
                </div>
                <div style={{ marginTop: 6 }}>Tip: try <b>Baner</b>, <b>Godrej woods</b>, or <b>zzzzzz</b>.</div>
              </div>
            </div>
          )}

          {showSuggest && (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.10)" }}>
              {suggestErr && (
                <div style={{ padding: "8px 12px", fontSize: 12, color: "salmon" }}>
                  GET /search/suggest failed: {suggestErr}
                </div>
              )}

              {(!suggestions || suggestions.length === 0) && !suggestErr && (
                <div style={{ padding: "10px 12px", fontSize: 12, opacity: 0.8 }}>No suggestions</div>
              )}

              {Array.isArray(suggestions) &&
                suggestions.map((s, idx) => (
                  <div
                    key={`${s.id || "id"}:${s.entity_type || "t"}:${idx}`}
                    style={{
                      padding: "10px 12px",
                      borderTop: "1px solid rgba(255,255,255,0.08)",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                    }}
                  >
                    <button
                      onClick={async () => {
                        setOpen(false);
                        await resolveAndRedirect(s.name);
                      }}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "white",
                        cursor: "pointer",
                        textAlign: "left",
                        padding: 0,
                      }}
                      title="Resolve and go"
                    >
                      <div style={{ fontSize: 13 }}>
                        {s.name}{" "}
                        <span style={{ fontSize: 12, opacity: 0.75 }}>
                          ({s.entity_type}
                          {s.city ? ` • ${s.city}` : ""})
                        </span>
                      </div>
                    </button>

                    {s.canonical_url ? (
                      <Link
                        href={s.canonical_url}
                        onClick={() => setOpen(false)}
                        style={{ fontSize: 12, opacity: 0.9, textDecoration: "underline" }}
                      >
                        Open
                      </Link>
                    ) : (
                      <span style={{ fontSize: 12, opacity: 0.5 }}> </span>
                    )}
                  </div>
                ))}

              <div style={{ padding: "10px 12px", fontSize: 12, opacity: 0.75 }}>
                <div>
                  <b>API:</b> {apiV1Base}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}