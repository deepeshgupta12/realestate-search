"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

// NOTE (local dev):
// The backend runs on :8000. For client-side calls we must hit the backend origin,
// not Next.js (:3000). Configure via NEXT_PUBLIC_API_V1_BASE if needed.
const API_V1_BASE_RAW =
  process.env.NEXT_PUBLIC_API_V1_BASE ||
  process.env.NEXT_PUBLIC_API_BASE || // allow existing env
  "http://localhost:8000/api/v1";

const API_V1_BASE = API_V1_BASE_RAW.replace(/\/+$/, "");

async function apiGetV1<T>(path: string): Promise<T> {
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = `${API_V1_BASE}${p}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${p} failed: ${res.status}`);
  return (await res.json()) as T;
}

async function apiPostV1<T>(path: string, body: unknown): Promise<T> {
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = `${API_V1_BASE}${p}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`POST ${p} failed: ${res.status}`);
  return (await res.json()) as T;
}

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

type SuggestResponse = {
  query: string;
  normalized_query: string;
  candidates: SuggestEntity[];
};

type ResolveResponse = {
  action: "redirect" | "serp" | "disambiguate";
  query: string;
  normalized_query: string;
  url: string | null;
  match?: SuggestEntity | null;
  candidates?: SuggestEntity[] | null;
  reason?: string | null;
  debug?: Record<string, any> | null;
};

type RecentItem = {
  query_id: string;
  raw_query: string;
  normalized_query: string;
  city_id?: string | null;
  context_url?: string | null;
  timestamp?: string;
};

type RecentResponse = {
  ok: boolean;
  items: RecentItem[];
};

function encodeQS(params: Record<string, string | number | boolean | null | undefined>) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === null || v === undefined) return;
    usp.set(k, String(v));
  });
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

function buildCityIdFromPath(pathname: string): string | null {
  // v1 demo: /pune/* => city_pune, /noida/* => city_noida
  const seg = (pathname || "/").split("?")[0].split("/").filter(Boolean)[0] || "";
  if (!seg) return null;
  // minimal mapping for demo; backend resolve can also work without it
  if (seg.toLowerCase() === "pune") return "city_pune";
  if (seg.toLowerCase() === "noida") return "city_noida";
  return null;
}

function isProbablyUrlOrPath(q: string) {
  const s = (q || "").trim().toLowerCase();
  return s.startsWith("http://") || s.startsWith("https://") || s.startsWith("/");
}

export default function SearchBar() {
  const router = useRouter();
  const pathname = usePathname();

  const cityId = useMemo(() => buildCityIdFromPath(pathname), [pathname]);
  const contextUrl = useMemo(() => pathname || "/", [pathname]);

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [suggest, setSuggest] = useState<SuggestEntity[]>([]);
  const [suggestErr, setSuggestErr] = useState<string | null>(null);

  const [loadingRecent, setLoadingRecent] = useState(false);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [recentErr, setRecentErr] = useState<string | null>(null);

  const [resolving, setResolving] = useState(false);
  const [resolveErr, setResolveErr] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);

  // --- Recent searches (zero state)
  async function loadRecent() {
    try {
      setLoadingRecent(true);
      setRecentErr(null);

      const qs = encodeQS({
        city_id: cityId ?? "",
        context_url: contextUrl ?? "",
        limit: 8,
      });

      const data = await apiGetV1<RecentResponse>(`/events/recent${qs}`);
      setRecent(data.items || []);
    } catch (e: any) {
      setRecentErr(e?.message || "Failed to load recent searches");
      setRecent([]);
    } finally {
      setLoadingRecent(false);
    }
  }

  async function clearRecentSearches() {
    try {
      await apiPostV1<{ ok: boolean }>(`/events/recent/clear`, {
        city_id: cityId,
        context_url: contextUrl,
      });
      setRecent([]);
    } catch {
      // non-blocking
    }
  }

  // --- Suggestions
  async function loadSuggest(nextQ: string) {
    const query = (nextQ || "").trim();
    if (!query || isProbablyUrlOrPath(query)) {
      setSuggest([]);
      setSuggestErr(null);
      return;
    }

    // abort previous
    if (suggestAbortRef.current) suggestAbortRef.current.abort();
    const ac = new AbortController();
    suggestAbortRef.current = ac;

    try {
      setLoadingSuggest(true);
      setSuggestErr(null);

      const qs = encodeQS({
        q: query,
        city_id: cityId ?? "",
        context_url: contextUrl ?? "",
        limit: 8,
      });

      const data = await apiGetV1<SuggestResponse>(`/search/suggest${qs}`);
      if (ac.signal.aborted) return;
      setSuggest(data.candidates || []);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setSuggestErr(e?.message || "Failed to load suggestions");
      setSuggest([]);
    } finally {
      if (!ac.signal.aborted) setLoadingSuggest(false);
    }
  }

  // --- Resolve + redirect (Enter)
  async function onSubmitResolve() {
    const raw = (q || "").trim();
    if (!raw) return;

    try {
      setResolving(true);
      setResolveErr(null);

      const qs = encodeQS({
        q: raw,
        city_id: cityId ?? "",
        context_url: contextUrl ?? "",
      });

      const data = await apiGetV1<ResolveResponse>(`/search/resolve${qs}`);

      // store event (best-effort)
      try {
        await apiPostV1<{ ok: boolean }>(`/events/search`, {
          query_id: crypto?.randomUUID ? crypto.randomUUID() : `qid_${Date.now()}`,
          raw_query: raw,
          normalized_query: data.normalized_query || raw,
          city_id: cityId,
          context_url: contextUrl,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // ignore
      }

      if (data.action === "redirect" && data.url) {
        setOpen(false);
        router.push(data.url);
        return;
      }

      if (data.action === "serp" && data.url) {
        setOpen(false);
        router.push(data.url);
        return;
      }

      // disambiguate: for v1 demo, send to SERP if url exists else do nothing
      if (data.url) {
        setOpen(false);
        router.push(data.url);
        return;
      }

      setResolveErr("Could not resolve query");
    } catch (e: any) {
      setResolveErr(e?.message || "Resolve failed");
    } finally {
      setResolving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onSubmitResolve();
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  function onFocus() {
    setOpen(true);
    // load recents only when opening and query empty
    if (!q.trim()) loadRecent();
  }

  // debounce suggestions
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (q.trim()) loadSuggest(q);
    }, 180);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open, cityId, contextUrl]);

  // click outside to close (simple)
  useEffect(() => {
    function onDocClick(ev: MouseEvent) {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      if (target.closest?.('[data-searchbar-root="1"]')) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const showZeroState = open && !q.trim();
  const showSuggest = open && !!q.trim();

  return (
    <div data-searchbar-root="1" style={{ position: "relative", width: "100%", maxWidth: 720 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          placeholder="Search city / locality / project…"
          style={{
            flex: 1,
            padding: "12px 12px",
            border: "1px solid #ddd",
            borderRadius: 10,
            outline: "none",
          }}
        />
        <button
          onClick={onSubmitResolve}
          disabled={resolving || !q.trim()}
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: resolving ? "#f3f3f3" : "white",
            cursor: resolving ? "default" : "pointer",
          }}
        >
          {resolving ? "Resolving…" : "Search"}
        </button>
      </div>

      {open && (
        <div
          style={{
            position: "absolute",
            top: 46,
            left: 0,
            right: 0,
            border: "1px solid #e5e5e5",
            borderRadius: 12,
            background: "white",
            boxShadow: "0 10px 24px rgba(0,0,0,0.08)",
            overflow: "hidden",
            zIndex: 50,
          }}
        >
          {resolveErr && (
            <div style={{ padding: 12, borderBottom: "1px solid #f0f0f0", color: "#b00020" }}>
              {resolveErr}
            </div>
          )}

          {showZeroState && (
            <div style={{ padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontWeight: 600 }}>Recent searches</div>
                <button
                  onClick={clearRecentSearches}
                  style={{
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    textDecoration: "underline",
                    fontSize: 12,
                  }}
                >
                  Clear
                </button>
              </div>

              <div style={{ marginTop: 10 }}>
                {loadingRecent && <div style={{ fontSize: 13, opacity: 0.7 }}>Loading…</div>}
                {recentErr && <div style={{ fontSize: 13, color: "#b00020" }}>{recentErr}</div>}
                {!loadingRecent && !recentErr && recent.length === 0 && (
                  <div style={{ fontSize: 13, opacity: 0.7 }}>No recent searches yet.</div>
                )}

                <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
                  {recent.map((r) => (
                    <button
                      key={r.query_id}
                      onClick={() => {
                        setQ(r.raw_query);
                        // immediately resolve on click (optional)
                        setTimeout(() => onSubmitResolve(), 0);
                      }}
                      style={{
                        textAlign: "left",
                        padding: "10px 10px",
                        borderRadius: 10,
                        border: "1px solid #f1f1f1",
                        marginBottom: 8,
                        background: "white",
                        cursor: "pointer",
                      }}
                    >
                      {r.raw_query}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {showSuggest && (
            <div style={{ padding: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>Suggestions</div>

              {loadingSuggest && <div style={{ fontSize: 13, opacity: 0.7 }}>Loading…</div>}
              {suggestErr && <div style={{ fontSize: 13, color: "#b00020" }}>{suggestErr}</div>}

              {!loadingSuggest && !suggestErr && suggest.length === 0 && (
                <div style={{ fontSize: 13, opacity: 0.7 }}>No suggestions.</div>
              )}

              <div style={{ display: "flex", flexDirection: "column" }}>
                {suggest.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 10px",
                      borderRadius: 10,
                      border: "1px solid #f1f1f1",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <div style={{ fontWeight: 600 }}>{s.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>
                        {s.entity_type}
                        {s.city ? ` • ${s.city}` : ""}
                        {s.parent_name ? ` • ${s.parent_name}` : ""}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10 }}>
                      {s.canonical_url ? (
                        <Link
                          href={s.canonical_url}
                          onClick={() => setOpen(false)}
                          style={{ fontSize: 13, textDecoration: "underline" }}
                        >
                          Open
                        </Link>
                      ) : (
                        <button
                          onClick={() => {
                            setQ(s.name);
                            setTimeout(() => onSubmitResolve(), 0);
                          }}
                          style={{
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            textDecoration: "underline",
                            fontSize: 13,
                          }}
                        >
                          Search
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                Tip: press <b>Enter</b> to resolve & redirect.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}