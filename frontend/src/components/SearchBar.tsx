"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

/**
 * SearchBar (v1.7b)
 * - Autocomplete + recent searches
 * - Enter triggers /search/resolve and client-side redirects
 *
 * NOTE: This version intentionally does NOT depend on "@/lib/api" to avoid env/base URL issues.
 */

type AutocompleteItem = {
  id: string;
  entity_type: string;
  name: string;
  city?: string;
  city_id?: string;
  canonical_url?: string;
  score?: number;
};

type AutocompleteResponse = {
  items: AutocompleteItem[];
};

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

type RecentItem = {
  query_id: string;
  raw_query: string;
  normalized_query: string;
  city_id: string | null;
  context_url: string;
  timestamp: string;
};

type RecentResponse = {
  items: RecentItem[];
};

function normalizeBase(raw: string | undefined, fallback: string) {
  // Defensive parsing: sometimes people accidentally pass the whole .env line,
  // or the string may include newlines.
  let v = (raw ?? "").trim();
  if (!v) v = fallback;

  // If someone accidentally provided "NEXT_PUBLIC_API_V1_BASE=http://..."
  if (v.includes("NEXT_PUBLIC_API_V1_BASE=")) {
    v = v.split("NEXT_PUBLIC_API_V1_BASE=").pop() || fallback;
  }
  if (v.includes("\n")) {
    v = v.split("\n").map((s) => s.trim()).find(Boolean) || v;
  }

  // Remove trailing slash
  v = v.replace(/\/+$/, "");
  return v;
}

function pickCitySlug(pathname: string) {
  const parts = pathname.split("?")[0].split("/").filter(Boolean);
  return parts.length ? parts[0] : null;
}

function citySlugToId(citySlug: string | null): string | null {
  if (!citySlug) return null;
  // Minimal mapping for this MVP (extend later)
  const m: Record<string, string> = {
    pune: "city_pune",
    noida: "city_noida",
  };
  return m[citySlug.toLowerCase()] || null;
}

async function apiGetJson<T>(base: string, path: string, params?: Record<string, string | number | null | undefined>) {
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

async function apiPostJson<T>(
  base: string,
  path: string,
  body: Record<string, any>,
) {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export default function SearchBar() {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loadingAuto, setLoadingAuto] = useState(false);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [items, setItems] = useState<AutocompleteItem[]>([]);
  const [recent, setRecent] = useState<RecentItem[]>([]);

  const blurTimer = useRef<number | null>(null);
  const lastAutoReq = useRef(0);

  const apiV1Base = useMemo(() => {
    // Prefer V1 base; fall back to API_BASE + /api/v1 if you only set NEXT_PUBLIC_API_BASE.
    const v1 = normalizeBase(process.env.NEXT_PUBLIC_API_V1_BASE, "");
    if (v1) return v1;

    const base = normalizeBase(process.env.NEXT_PUBLIC_API_BASE, "http://localhost:8000");
    return `${base}/api/v1`.replace(/\/+$/, "");
  }, []);

  const citySlug = useMemo(() => pickCitySlug(pathname), [pathname]);
  const cityId = useMemo(() => citySlugToId(citySlug), [citySlug]);

  const contextUrl = useMemo(() => {
    // Use the first segment as city context if available, else "/"
    return citySlug ? `/${encodeURIComponent(citySlug)}` : "/";
  }, [citySlug]);

  async function loadRecent() {
    setLoadingRecent(true);
    setErr(null);
    try {
      const data = await apiGetJson<RecentResponse>(apiV1Base, "/events/recent", {
        context_url: contextUrl,
        limit: 8,
      });
      setRecent(data.items ?? []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load recent searches");
      setRecent([]);
    } finally {
      setLoadingRecent(false);
    }
  }

  async function runAutocomplete(query: string) {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setItems([]);
      return;
    }

    const reqId = Date.now();
    lastAutoReq.current = reqId;

    setLoadingAuto(true);
    setErr(null);

    try {
      const data = await apiGetJson<AutocompleteResponse>(apiV1Base, "/search/autocomplete", {
        q: trimmed,
        city_id: cityId,
        context_url: contextUrl,
      });
      // ignore stale responses
      if (lastAutoReq.current !== reqId) return;
      setItems(data.items ?? []);
    } catch (e: any) {
      if (lastAutoReq.current !== reqId) return;
      setErr(e?.message || "Autocomplete failed");
      setItems([]);
    } finally {
      if (lastAutoReq.current === reqId) setLoadingAuto(false);
    }
  }

  function storeDisambiguation(payload: { query: string; candidates: ResolveMatch[] }) {
    try {
      sessionStorage.setItem("disambiguate_payload_v1", JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  async function resolveAndRedirect(rawQuery: string) {
    const trimmed = rawQuery.trim();
    if (!trimmed) return;

    setErr(null);

    try {
      const data = await apiGetJson<ResolveResponse>(apiV1Base, "/search/resolve", {
        q: trimmed,
        city_id: cityId,
        context_url: contextUrl,
      });

      // Track searches (best-effort; non-blocking)
      void apiPostJson(apiV1Base, "/events/search", {
        query_id: `qid_${Date.now()}`,
        raw_query: trimmed,
        normalized_query: data.normalized_query ?? trimmed,
        city_id: cityId,
        context_url: contextUrl,
        timestamp: new Date().toISOString(),
      }).catch(() => {});

      if (data.action === "redirect" || data.action === "serp") {
        router.push(data.url);
        return;
      }

      if (data.action === "disambiguate") {
        storeDisambiguation({
          query: trimmed,
          candidates: data.candidates ?? [],
        });
        router.push(`/disambiguate?q=${encodeURIComponent(trimmed)}&context_url=${encodeURIComponent(contextUrl)}`);
        return;
      }

      // Fallback: SERP
      router.push(`/search?q=${encodeURIComponent(trimmed)}&context_url=${encodeURIComponent(contextUrl)}${cityId ? `&city_id=${encodeURIComponent(cityId)}` : ""}`);
    } catch (e: any) {
      setErr(e?.message || "Resolve failed");
    }
  }

  function onFocus() {
    setOpen(true);
    if (blurTimer.current) window.clearTimeout(blurTimer.current);
    // Load recent on focus (esp for homepage)
    void loadRecent();
  }

  function onBlur() {
    // small delay so clicks inside dropdown still work
    blurTimer.current = window.setTimeout(() => setOpen(false), 120);
  }

  function onClear() {
    setQ("");
    setItems([]);
    setErr(null);
    setOpen(false);
  }

  useEffect(() => {
    // When the context changes (city route), refresh recent searches
    void loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextUrl]);

  return (
    <div style={{ width: "min(720px, 92vw)", margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={q}
          onChange={(e) => {
            const v = e.target.value;
            setQ(v);
            setOpen(true);
            void runAutocomplete(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void resolveAndRedirect(q);
            } else if (e.key === "Escape") {
              onClear();
            }
          }}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder="Search city / locality / project..."
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(255,255,255,0.06)",
            color: "white",
            outline: "none",
          }}
        />
        <button
          onClick={() => void resolveAndRedirect(q)}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(255,255,255,0.10)",
            color: "white",
            cursor: "pointer",
          }}
        >
          Search
        </button>
      </div>

      {(open || err) && (
        <div
          style={{
            marginTop: 8,
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(0,0,0,0.50)",
            overflow: "hidden",
          }}
          onMouseDown={(e) => {
            // prevent input blur when clicking dropdown content
            e.preventDefault();
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px" }}>
            <div style={{ opacity: 0.9, fontSize: 13 }}>
              <span style={{ marginRight: 10 }}>
                <b>context:</b> {contextUrl}
              </span>
              {cityId && (
                <span>
                  <b>city_id:</b> {cityId}
                </span>
              )}
            </div>
            <button
              onClick={onClear}
              style={{
                fontSize: 12,
                background: "transparent",
                border: "none",
                color: "rgba(255,255,255,0.85)",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Clear
            </button>
          </div>

          {err && (
            <div style={{ padding: "10px 12px", color: "#ff6b6b", fontSize: 13, borderTop: "1px solid rgba(255,255,255,0.10)" }}>
              {err}
            </div>
          )}

          {/* Autocomplete */}
          {q.trim().length >= 2 && (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.10)" }}>
              <div style={{ padding: "8px 12px", fontSize: 12, opacity: 0.85 }}>
                {loadingAuto ? "Searching…" : items.length ? "Suggestions" : "No suggestions"}
              </div>

              {items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => {
                    setQ(it.name);
                    setOpen(false);
                    void resolveAndRedirect(it.name);
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    background: "transparent",
                    border: "none",
                    borderTop: "1px solid rgba(255,255,255,0.08)",
                    color: "white",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 14 }}>
                      {it.name}{" "}
                      <span style={{ opacity: 0.7, fontSize: 12 }}>
                        ({it.entity_type}
                        {it.city ? ` · ${it.city}` : ""})
                      </span>
                    </div>
                    {it.canonical_url && (
                      <span style={{ opacity: 0.7, fontSize: 12, whiteSpace: "nowrap" }}>{it.canonical_url}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Recent searches (zero-state) */}
          {q.trim().length < 2 && (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.10)" }}>
              <div style={{ padding: "8px 12px", fontSize: 12, opacity: 0.85 }}>
                {loadingRecent ? "Loading recent…" : recent.length ? "Recent searches" : "No recent searches yet"}
              </div>

              {recent.map((r) => (
                <div
                  key={r.query_id}
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
                    onClick={() => {
                      setQ(r.raw_query);
                      setOpen(false);
                      void resolveAndRedirect(r.raw_query);
                    }}
                    style={{
                      flex: 1,
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
                      color: "white",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    <div style={{ fontSize: 14 }}>{r.raw_query}</div>
                    <div style={{ fontSize: 12, opacity: 0.65 }}>
                      {r.context_url} {r.city_id ? `· ${r.city_id}` : ""}
                    </div>
                  </button>

                  <Link
                    href={`/search?q=${encodeURIComponent(r.raw_query)}&context_url=${encodeURIComponent(r.context_url)}${r.city_id ? `&city_id=${encodeURIComponent(r.city_id)}` : ""}`}
                    style={{ fontSize: 12, opacity: 0.8, textDecoration: "underline", color: "white", whiteSpace: "nowrap" }}
                  >
                    Go to SERP
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.65 }}>
        <div>
          <b>API:</b> {apiV1Base}
        </div>
      </div>
    </div>
  );
}
