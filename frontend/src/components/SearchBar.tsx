"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * SearchBar
 * - Autocomplete: GET /api/v1/search/autocomplete?q=...&limit=...&city_id=...
 * - Enter / Search button: GET /api/v1/search/resolve?q=...&city_id=...&context_url=... -> redirect
 * - Recent (zero-state): GET /api/v1/events/recent?context_url=...&limit=...
 * - Persist searches: POST /api/v1/events/search
 */

type EntityType =
  | "city"
  | "locality"
  | "micromarket"
  | "project"
  | "rate_page"
  | "locality_overview"
  | "developer"
  | "builder"
  | "other";

type SuggestItem = {
  id: string;
  entity_type: EntityType | string;
  name: string;
  city_id?: string | null;
  city?: string | null;
  parent_name?: string | null;
  canonical_url?: string | null;
  score?: number | null;
  popularity_score?: number | null;
};

type AutocompleteResponse = {
  ok: boolean;
  items: SuggestItem[];
};

type ResolveResponse = {
  action: "redirect" | "disambiguate" | "serp";
  query: string;
  normalized_query: string;
  url?: string | null;
  candidates?: SuggestItem[] | null;
  reason?: string | null;
  match?: SuggestItem | null;
  debug?: Record<string, any> | null;
};

type RecentItem = {
  q: string;
  city_id: string | null;
  context_url: string;
  ts: string;
};

type RecentResponse = {
  ok: boolean;
  items: RecentItem[];
};

const API_V1_BASE =
  process.env.NEXT_PUBLIC_API_V1_BASE || "http://localhost:8000/api/v1";

function safeCityIdFromPathname(pathname: string): string | null {
  // Our routes are /[city]/... or /property-rates/[city]/...
  const parts = (pathname || "/").split("?")[0].split("/").filter(Boolean);
  if (!parts.length) return null;

  // If route is /property-rates/pune/baner => city is parts[1]
  if (parts[0] === "property-rates" && parts.length >= 2) {
    const citySlug = parts[1];
    return citySlug ? `city_${citySlug}` : null;
  }

  // If route is /pune/baner/buy => city is parts[0]
  const citySlug = parts[0];
  return citySlug ? `city_${citySlug}` : null;
}

async function apiGet<T>(path: string, params: Record<string, string | undefined>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") usp.set(k, v);
  }
  const url = `${API_V1_BASE}${path}?${usp.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

async function apiPost<T>(path: string, body: any) {
  const url = `${API_V1_BASE}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export default function SearchBar() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [suggestErr, setSuggestErr] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestItem[]>([]);

  const [loadingRecent, setLoadingRecent] = useState(false);
  const [recentErr, setRecentErr] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);

  const [busyResolve, setBusyResolve] = useState(false);
  const [resolveErr, setResolveErr] = useState<string | null>(null);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const contextUrl = useMemo(() => {
    // If caller provided explicit context_url, respect it; else use current pathname.
    const ctx = sp.get("context_url");
    return ctx && ctx.startsWith("/") ? ctx : pathname || "/";
  }, [sp, pathname]);

  const cityId = useMemo(() => {
    // If explicit city_id in URL, use it; else infer from pathname.
    const cid = sp.get("city_id");
    if (cid) return cid;
    return safeCityIdFromPathname(pathname || "/") || undefined;
  }, [sp, pathname]);

  // Close dropdown on outside click
  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  // Load recent searches when opening dropdown (zero-state)
  useEffect(() => {
    if (!open) return;
    setLoadingRecent(true);
    setRecentErr(null);

    apiGet<RecentResponse>("/events/recent", {
      context_url: contextUrl,
      limit: "8",
    })
      .then((data) => setRecent(data.items || []))
      .catch((e: any) => setRecentErr(e?.message || String(e)))
      .finally(() => setLoadingRecent(false));
  }, [open, contextUrl]);

  // Autocomplete
  useEffect(() => {
    const q = query.trim();
    if (!open) return;

    if (!q) {
      setSuggestions([]);
      setSuggestErr(null);
      setLoadingSuggest(false);
      return;
    }

    let cancelled = false;
    setLoadingSuggest(true);
    setSuggestErr(null);

    apiGet<AutocompleteResponse>("/search/autocomplete", {
      q,
      limit: "20",
      city_id,
      context_url: contextUrl, // accepted (ignored) by BE alias
    })
      .then((data) => {
        if (cancelled) return;
        setSuggestions(data.items || []);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setSuggestErr(e?.message || String(e));
        setSuggestions([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingSuggest(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query, open, city_id, contextUrl]);

  async function persistSearch(q: string) {
    const payload = {
      query_id: `qid_${Date.now()}`,
      raw_query: q,
      normalized_query: q.toLowerCase(),
      city_id: city_id ?? null,
      context_url: contextUrl,
      timestamp: new Date().toISOString(),
    };
    try {
      await apiPost<{ ok: boolean }>("/events/search", payload);
    } catch {
      // non-blocking
    }
  }

  async function doResolve(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;

    setBusyResolve(true);
    setResolveErr(null);

    try {
      await persistSearch(trimmed);

      const data = await apiGet<ResolveResponse>("/search/resolve", {
        q: trimmed,
        city_id: city_id,
        context_url: contextUrl,
      });

      if (data.action === "redirect" && data.url) {
        setOpen(false);
        router.push(data.url);
        return;
      }

      if (data.action === "disambiguate") {
        setOpen(false);
        router.push(
          `/disambiguate?q=${encodeURIComponent(trimmed)}&context_url=${encodeURIComponent(
            contextUrl
          )}${city_id ? `&city_id=${encodeURIComponent(city_id)}` : ""}`
        );
        return;
      }

      // fallback: SERP
      setOpen(false);
      router.push(
        `/search?q=${encodeURIComponent(trimmed)}&context_url=${encodeURIComponent(contextUrl)}${
          city_id ? `&city_id=${encodeURIComponent(city_id)}` : ""
        }`
      );
    } catch (e: any) {
      setResolveErr(e?.message || String(e));
    } finally {
      setBusyResolve(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      doResolve(query);
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} style={{ width: "100%", maxWidth: 760 }}>
      <div style={{ display: "flex", gap: 10 }}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search city / locality / project..."
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #333",
            background: "rgba(0,0,0,0.25)",
            color: "inherit",
            outline: "none",
          }}
        />
        <button
          onClick={() => doResolve(query)}
          disabled={busyResolve}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #333",
            background: "rgba(255,255,255,0.06)",
            color: "inherit",
            cursor: busyResolve ? "not-allowed" : "pointer",
          }}
        >
          {busyResolve ? "…" : "Search"}
        </button>
      </div>

      {open ? (
        <div
          style={{
            marginTop: 10,
            borderRadius: 12,
            border: "1px solid #333",
            background: "rgba(0,0,0,0.35)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 12px",
              borderBottom: "1px solid #2a2a2a",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div style={{ fontSize: 13, opacity: 0.9 }}>
              <b>context:</b> {contextUrl}
            </div>
            <button
              onClick={() => {
                setQuery("");
                setSuggestions([]);
                setSuggestErr(null);
                setResolveErr(null);
                inputRef.current?.focus();
              }}
              style={{
                border: "none",
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
                textDecoration: "underline",
                fontSize: 12,
                opacity: 0.85,
              }}
            >
              Clear
            </button>
          </div>

          {/* Autocomplete section */}
          {query.trim() ? (
            <div style={{ padding: "10px 12px" }}>
              {suggestErr ? (
                <div style={{ color: "#ff6b6b", fontSize: 13 }}>
                  GET /search/autocomplete failed: {suggestErr.includes("failed:")
                    ? suggestErr.split("failed:").slice(-1)[0].trim()
                    : suggestErr}
                </div>
              ) : loadingSuggest ? (
                <div style={{ fontSize: 13, opacity: 0.8 }}>Loading suggestions…</div>
              ) : suggestions.length === 0 ? (
                <div style={{ fontSize: 13, opacity: 0.75 }}>No suggestions</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {suggestions.slice(0, 8).map((s) => {
                    const meta = [s.city || "", s.parent_name || "", String(s.entity_type || "")]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <button
                        key={`${s.entity_type}:${s.id}`}
                        onClick={() => {
                          setQuery(s.name);
                          doResolve(s.name);
                        }}
                        style={{
                          textAlign: "left",
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid #2a2a2a",
                          background: "rgba(255,255,255,0.04)",
                          color: "inherit",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ fontWeight: 650 }}>{s.name}</div>
                        {meta ? (
                          <div style={{ opacity: 0.75, fontSize: 12, marginTop: 4 }}>{meta}</div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}

              {resolveErr ? (
                <div style={{ marginTop: 10, color: "#ff6b6b", fontSize: 13 }}>
                  Resolve error: {resolveErr}
                </div>
              ) : null}
            </div>
          ) : (
            /* Zero-state: recent searches */
            <div style={{ padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 13, fontWeight: 650, opacity: 0.9 }}>Recent searches</div>
                <button
                  onClick={() => router.push(`/search?q=&context_url=${encodeURIComponent(contextUrl)}`)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "inherit",
                    cursor: "pointer",
                    textDecoration: "underline",
                    fontSize: 12,
                    opacity: 0.85,
                  }}
                >
                  Go to SERP
                </button>
              </div>

              {recentErr ? (
                <div style={{ marginTop: 10, color: "#ff6b6b", fontSize: 13 }}>
                  GET /events/recent failed: {recentErr}
                </div>
              ) : loadingRecent ? (
                <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>Loading…</div>
              ) : recent.length === 0 ? (
                <div style={{ marginTop: 10, fontSize: 13, opacity: 0.75 }}>
                  No recent searches yet
                </div>
              ) : (
                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  {recent.map((r) => {
                    const label = r.q;
                    return (
                      <div
                        key={`${r.ts}-${r.q}`}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid #2a2a2a",
                          background: "rgba(255,255,255,0.03)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                        }}
                      >
                        <button
                          onClick={() => setQuery(r.q)}
                          style={{
                            border: "none",
                            background: "transparent",
                            color: "inherit",
                            cursor: "pointer",
                            textAlign: "left",
                            padding: 0,
                            flex: 1,
                          }}
                        >
                          <div style={{ fontWeight: 650 }}>{label}</div>
                          <div style={{ opacity: 0.7, fontSize: 12, marginTop: 4 }}>
                            <code>{r.context_url}</code>
                          </div>
                        </button>

                        <button
                          onClick={() => doResolve(r.q)}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 10,
                            border: "1px solid #2a2a2a",
                            background: "rgba(255,255,255,0.04)",
                            color: "inherit",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Go
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
                API: {API_V1_BASE}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}