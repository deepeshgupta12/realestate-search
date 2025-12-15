"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import type { EntityOut, SuggestResponse, ZeroStateResponse } from "@/lib/types";

type Props = { className?: string };

type RecentItem = { q: string; cityId?: string; ts: number };

type ResolveResponse = {
  action: "redirect" | "serp" | "disambiguate";
  query: string;
  normalized_query: string;
  url?: string | null;
  match?: EntityOut | null;
  reason?: string | null;
  debug?: Record<string, any> | null;
};

const LS_KEY = "re_recent_searches_v1";
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api/v1";

function nowIso() {
  return new Date().toISOString();
}

function mkQueryId() {
  // stable, no extra deps
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `qid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function buildUrl(path: string, query?: Record<string, any>) {
  const u = new URL(`${API_BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

async function apiPost<T>(path: string, body: any): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`POST ${path} failed: ${res.status} ${txt}`);
  }
  return (await res.json()) as T;
}

function loadRecents(): RecentItem[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as RecentItem[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.q === "string" && typeof x.ts === "number")
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 8);
  } catch {
    return [];
  }
}

function saveRecent(item: RecentItem) {
  const curr = loadRecents();
  const next = [
    item,
    ...curr.filter(
      (x) => !(x.q.toLowerCase() === item.q.toLowerCase() && (x.cityId || "") === (item.cityId || ""))
    ),
  ].slice(0, 8);
  localStorage.setItem(LS_KEY, JSON.stringify(next));
}

function groupLabel(k: keyof SuggestResponse["groups"]) {
  switch (k) {
    case "locations":
      return "Locations";
    case "projects":
      return "Projects";
    case "builders":
      return "Builders";
    case "rate_pages":
      return "Property Rates";
    case "property_pdps":
      return "Properties";
    default:
      return String(k);
  }
}

function badgeForEntity(e: EntityOut) {
  // small compact badges (kept minimal to avoid UI regressions)
  const t = e.entity_type;
  if (t === "builder" || t === "developer") return "BLD";
  if (t === "project") return "PRJ";
  if (t === "rate_page") return "RATE";
  if (t === "property_pdp") return "PROP";
  if (t === "locality") return "LOC";
  if (t === "micromarket") return "MM";
  if (t === "city") return "CITY";
  return t.slice(0, 3).toUpperCase();
}

export default function SearchBar({ className }: Props) {
  const router = useRouter();

  const [q, setQ] = useState("");
  const [cityId, setCityId] = useState<string>("");
  const [open, setOpen] = useState(false);

  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [suggestErr, setSuggestErr] = useState<string | null>(null);
  const [suggest, setSuggest] = useState<SuggestResponse | null>(null);

  const [zero, setZero] = useState<ZeroStateResponse | null>(null);
  const [loadingZero, setLoadingZero] = useState(false);
  const [zeroErr, setZeroErr] = useState<string | null>(null);

  const [recents, setRecents] = useState<RecentItem[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // active query_id for logging click events after a search event is fired
  const activeQidRef = useRef<string | null>(null);

  useEffect(() => {
    setRecents(loadRecents());
  }, []);

  const hasText = q.trim().length > 0;

  const grouped = useMemo(() => {
    const g = suggest?.groups;
    if (!g) return [];
    const keys = Object.keys(g) as (keyof SuggestResponse["groups"])[];
    return keys
      .map((k) => ({ k, items: g[k] || [] }))
      .filter((x) => x.items.length > 0);
  }, [suggest]);

  async function loadZeroState() {
    setLoadingZero(true);
    setZeroErr(null);
    try {
      const z = await apiGet<ZeroStateResponse>("/search/zero-state", {
        city_id: cityId || undefined,
        limit: 8,
      });
      setZero(z);
    } catch (e: any) {
      setZero(null);
      setZeroErr(e?.message || "Failed to load zero-state");
    } finally {
      setLoadingZero(false);
    }
  }

  async function loadSuggest(nextQ: string) {
    setLoadingSuggest(true);
    setSuggestErr(null);
    try {
      const s = await apiGet<SuggestResponse>("/search/suggest", {
        q: nextQ,
        city_id: cityId || undefined,
        limit: 10,
      });
      setSuggest(s);
    } catch (e: any) {
      setSuggest(null);
      setSuggestErr(e?.message || "Failed to load suggest");
    } finally {
      setLoadingSuggest(false);
    }
  }

  // debounce suggest
  useEffect(() => {
    if (!open) return;

    const t = setTimeout(() => {
      if (!hasText) {
        setSuggest(null);
        setSuggestErr(null);
        return;
      }
      void loadSuggest(q.trim());
    }, 180);

    return () => clearTimeout(t);
  }, [q, open, cityId]); // eslint-disable-line react-hooks/exhaustive-deps

  // load zero-state when opening (or city changes while open with empty q)
  useEffect(() => {
    if (!open) return;
    if (hasText) return;
    void loadZeroState();
  }, [open, cityId, hasText]); // eslint-disable-line react-hooks/exhaustive-deps

  function close() {
    setOpen(false);
    setSuggestErr(null);
    setZeroErr(null);
  }

  function openDropdown() {
    setOpen(true);
  }

  function persistRecent(text: string) {
    const item: RecentItem = { q: text, cityId: cityId || undefined, ts: Date.now() };
    saveRecent(item);
    setRecents(loadRecents());
  }

  function fireSearchEvent(params: {
    query_id: string;
    raw_query: string;
    normalized_query: string;
    city_id?: string | null;
    context_url?: string | null;
  }) {
    // fire-and-forget (do not block navigation)
    void apiPost<{ ok: boolean }>("/events/search", {
      query_id: params.query_id,
      raw_query: params.raw_query,
      normalized_query: params.normalized_query,
      city_id: params.city_id ?? null,
      context_url: params.context_url ?? null,
      timestamp: nowIso(),
    }).catch(() => {});
  }

  function fireClickEvent(params: {
    query_id: string;
    entity_id: string;
    entity_type: string;
    rank: number;
    url: string;
  }) {
    void apiPost<{ ok: boolean }>("/events/click", {
      query_id: params.query_id,
      entity_id: params.entity_id,
      entity_type: params.entity_type,
      rank: params.rank,
      url: params.url,
      timestamp: nowIso(),
    }).catch(() => {});
  }

  function newQid(raw: string) {
    const qid = mkQueryId();
    activeQidRef.current = qid;
    fireSearchEvent({
      query_id: qid,
      raw_query: raw,
      normalized_query: raw.trim().toLowerCase(),
      city_id: cityId || null,
      context_url: "/",
    });
    return qid;
  }

  async function onSubmit() {
    const text = q.trim();
    if (!text) return;

    persistRecent(text);
    close();

    const qid = newQid(text);

    // Resolve: redirect vs serp (and serp url returned for constraint-heavy)
    try {
      const r = await apiGet<ResolveResponse>("/search/resolve", {
        q: text,
        city_id: cityId || undefined,
      });

      if (r.action === "redirect" && r.url) {
        // log click if resolver returned match
        if (r.match?.id && r.match?.entity_type) {
          fireClickEvent({
            query_id: qid,
            entity_id: r.match.id,
            entity_type: r.match.entity_type,
            rank: 1,
            url: r.url,
          });
        }
        router.push(`/go?url=${encodeURIComponent(r.url)}&q=${encodeURIComponent(text)}`);
        return;
      }

      // SERP path (prefer backend-provided url)
      const serpUrl = r.url || `/search?q=${encodeURIComponent(text)}${cityId ? `&city_id=${encodeURIComponent(cityId)}` : ""}`;
      router.push(serpUrl);
    } catch {
      // fallback: go to SERP
      router.push(`/search?q=${encodeURIComponent(text)}${cityId ? `&city_id=${encodeURIComponent(cityId)}` : ""}`);
    }
  }

  function onPickEntity(e: EntityOut, rank: number) {
    const label = e.name || q.trim() || "search";
    const raw = q.trim() || label;

    persistRecent(raw);
    close();

    const qid = newQid(raw);
    fireClickEvent({
      query_id: qid,
      entity_id: e.id,
      entity_type: e.entity_type,
      rank,
      url: e.canonical_url,
    });

    router.push(`/go?url=${encodeURIComponent(e.canonical_url)}&q=${encodeURIComponent(label)}`);
  }

  function onPickSerp(text: string) {
    const raw = text.trim();
    if (!raw) return;

    persistRecent(raw);
    close();

    newQid(raw);
    router.push(`/search?q=${encodeURIComponent(raw)}${cityId ? `&city_id=${encodeURIComponent(cityId)}` : ""}`);
  }

  return (
    <div className={className}>
      <div className="searchBar">
        <select
          className="select"
          value={cityId}
          onChange={(e) => setCityId(e.target.value)}
          aria-label="City filter"
        >
          <option value="">All Cities</option>
          <option value="city_pune">Pune</option>
          <option value="city_noida">Noida</option>
        </select>

        <div className="inputWrap">
          <input
            ref={inputRef}
            className="input"
            placeholder="Search city, locality, project, builder, rates, properties..."
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (!open) openDropdown();
            }}
            onFocus={() => openDropdown()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onSubmit();
              }
              if (e.key === "Escape") close();
            }}
          />

          <button className="btn" type="button" onClick={() => void onSubmit()}>
            Search
          </button>

          {open && (
            <div className="dropdown" role="listbox">
              {/* Suggest path */}
              {hasText ? (
                <div className="ddInner">
                  {loadingSuggest && <div className="ddMuted">Searching…</div>}
                  {suggestErr && <div className="ddError">{suggestErr}</div>}

                  {!loadingSuggest && !suggestErr && grouped.length === 0 && (
                    <div className="ddMuted">No matches. Press Enter to search.</div>
                  )}

                  {!loadingSuggest &&
                    !suggestErr &&
                    grouped.map(({ k, items }) => (
                      <div key={String(k)} className="ddSection">
                        <div className="ddTitle">{groupLabel(k)}</div>
                        <div className="ddList">
                          {items.map((e, idx) => (
                            <button
                              key={`${e.id}:${idx}`}
                              type="button"
                              className="ddItem"
                              onClick={() => onPickEntity(e, idx + 1)}
                            >
                              <span className="ddBadge">{badgeForEntity(e)}</span>
                              <span className="ddText">
                                <span className="ddName">{e.name}</span>
                                <span className="ddMeta">
                                  {e.entity_type}
                                  {e.city ? ` • ${e.city}` : ""}
                                  {e.parent_name ? ` • ${e.parent_name}` : ""}
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}

                  {/* See all results */}
                  <div className="ddFooter">
                    <button
                      type="button"
                      className="ddSeeAll"
                      onClick={() => onPickSerp(q)}
                    >
                      See all results for “{q.trim()}”
                    </button>
                  </div>
                </div>
              ) : (
                // Zero-state path
                <div className="ddInner">
                  {loadingZero && <div className="ddMuted">Loading…</div>}
                  {zeroErr && <div className="ddError">{zeroErr}</div>}

                  {!loadingZero && !zeroErr && (
                    <>
                      {recents.length > 0 && (
                        <div className="ddSection">
                          <div className="ddTitle">Recent searches</div>
                          <div className="ddList">
                            {recents.map((it, idx) => (
                              <button
                                key={`${it.cityId || ""}:${it.q}:${it.ts}:${idx}`}
                                type="button"
                                className="ddItem"
                                onClick={() => {
                                  setQ(it.q);
                                  void onPickSerp(it.q);
                                }}
                              >
                                <span className="ddBadge">⟳</span>
                                <span className="ddText">
                                  <span className="ddName">{it.q}</span>
                                  <span className="ddMeta">{it.cityId ? it.cityId : "All cities"}</span>
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {zero?.trending_searches?.length ? (
                        <div className="ddSection">
                          <div className="ddTitle">Trending</div>
                          <div className="ddList">
                            {zero.trending_searches.map((e, idx) => (
                              <button
                                key={`${e.id}:${idx}`}
                                type="button"
                                className="ddItem"
                                onClick={() => onPickEntity(e, idx + 1)}
                              >
                                <span className="ddBadge">{badgeForEntity(e)}</span>
                                <span className="ddText">
                                  <span className="ddName">{e.name}</span>
                                  <span className="ddMeta">
                                    {e.entity_type}
                                    {e.city ? ` • ${e.city}` : ""}
                                    {e.parent_name ? ` • ${e.parent_name}` : ""}
                                  </span>
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {zero?.trending_localities?.length ? (
                        <div className="ddSection">
                          <div className="ddTitle">Popular localities</div>
                          <div className="ddList">
                            {zero.trending_localities.map((e, idx) => (
                              <button
                                key={`${e.id}:${idx}`}
                                type="button"
                                className="ddItem"
                                onClick={() => onPickEntity(e, idx + 1)}
                              >
                                <span className="ddBadge">{badgeForEntity(e)}</span>
                                <span className="ddText">
                                  <span className="ddName">{e.name}</span>
                                  <span className="ddMeta">
                                    {e.entity_type}
                                    {e.city ? ` • ${e.city}` : ""}
                                    {e.parent_name ? ` • ${e.parent_name}` : ""}
                                  </span>
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}