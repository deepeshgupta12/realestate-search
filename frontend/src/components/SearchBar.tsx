"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import type { EntityOut, ResolveResponse, SuggestResponse, ZeroStateResponse } from "@/lib/types";

type RecentSearch = {
  q: string;
  cityId?: string | null;
  ts: number;
};

const RECENTS_KEY = "re_recent_searches_v1";
const MAX_RECENTS = 8;

function normalizeSpace(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function badgeForEntityType(t: string) {
  const x = (t || "").toLowerCase();
  if (x === "builder" || x === "developer") return "BLD";
  if (x === "project") return "PRJ";
  if (x === "rate_page") return "RATE";
  if (x === "property_pdp") return "PROP";
  if (x === "city") return "CITY";
  if (x === "micromarket") return "MM";
  if (x === "locality") return "LOC";
  return "ENT";
}

function safeJson<T>(v: string | null): T | null {
  if (!v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

function readRecents(): RecentSearch[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(RECENTS_KEY);
  const parsed = safeJson<RecentSearch[]>(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((x) => x && typeof x.q === "string" && typeof x.ts === "number")
    .sort((a, b) => b.ts - a.ts)
    .slice(0, MAX_RECENTS);
}

function writeRecents(items: RecentSearch[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(RECENTS_KEY, JSON.stringify(items.slice(0, MAX_RECENTS)));
}

function upsertRecent(q: string, cityId: string | null | undefined) {
  const qq = normalizeSpace(q);
  if (!qq) return;

  const now = Date.now();
  const items = readRecents();
  const filtered = items.filter(
    (x) => normalizeSpace(x.q).toLowerCase() !== qq.toLowerCase() || (x.cityId || null) !== (cityId || null)
  );
  filtered.unshift({ q: qq, cityId: cityId || null, ts: now });
  writeRecents(filtered);
}

export default function SearchBar() {
  const router = useRouter();

  const [cityId, setCityId] = useState<string>("");
  const [q, setQ] = useState<string>("");

  const [open, setOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const [suggest, setSuggest] = useState<SuggestResponse | null>(null);
  const [zero, setZero] = useState<ZeroStateResponse | null>(null);
  const [recents, setRecents] = useState<RecentSearch[]>([]);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<number | null>(null);
  const reqSeqRef = useRef<number>(0);

  const qTrim = useMemo(() => normalizeSpace(q), [q]);

  // Load local recents once (client-side)
  useEffect(() => {
    setRecents(readRecents());
  }, []);

  // Close on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as any)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function fetchZeroState() {
    const seq = ++reqSeqRef.current;
    setLoading(true);
    setErrMsg(null);

    try {
      const data = await apiGet<ZeroStateResponse>("/search/zero-state", {
        city_id: cityId || undefined,
        limit: 8,
      });
      if (seq !== reqSeqRef.current) return; // stale
      setZero(data);
    } catch (e: any) {
      if (seq !== reqSeqRef.current) return;
      setZero(null);
      setErrMsg(e?.message || "Failed to load zero-state");
    } finally {
      if (seq === reqSeqRef.current) setLoading(false);
    }
  }

  async function fetchSuggest(query: string) {
    const seq = ++reqSeqRef.current;
    setLoading(true);
    setErrMsg(null);

    try {
      const data = await apiGet<SuggestResponse>("/search/suggest", {
        q: query,
        city_id: cityId || undefined,
        limit: 10,
      });
      if (seq !== reqSeqRef.current) return; // stale
      setSuggest(data);
    } catch (e: any) {
      if (seq !== reqSeqRef.current) return;
      setSuggest(null);
      setErrMsg(e?.message || "Failed to load suggestions");
    } finally {
      if (seq === reqSeqRef.current) setLoading(false);
    }
  }

  // When dropdown is open:
  // - if q empty => zero-state
  // - else => suggest (debounced)
  useEffect(() => {
    if (!open) return;

    if (!qTrim) {
      setSuggest(null);
      fetchZeroState();
      return;
    }

    // debounce suggestions
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      fetchSuggest(qTrim);
    }, 180);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, qTrim, cityId]);

  async function goResolve(query: string) {
    const qq = normalizeSpace(query);
    if (!qq) return;

    setLoading(true);
    setErrMsg(null);

    try {
      const res = await apiGet<ResolveResponse>("/search/resolve", {
        q: qq,
        city_id: cityId || undefined,
      });

      // Save local recent (V0)
      upsertRecent(qq, cityId || null);
      setRecents(readRecents());

      if (res.action === "redirect" && res.url) {
        router.push(res.url);
        setOpen(false);
        return;
      }

      // serp action => URL may already be built by backend (your Step 2.1 fix)
      if (res.action === "serp" && res.url) {
        router.push(res.url);
        setOpen(false);
        return;
      }

      // fallback
      router.push(`/search?q=${encodeURIComponent(qq)}${cityId ? `&city_id=${encodeURIComponent(cityId)}` : ""}`);
      setOpen(false);
    } catch (e: any) {
      setErrMsg(e?.message || "Resolve failed");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    goResolve(qTrim);
  }

  const showSeeAll = qTrim.length > 0; // prevents: See all results for ""

  const localRecentQueries = recents
    .filter((x) => (cityId ? (x.cityId || "") === cityId : true))
    .slice(0, MAX_RECENTS);

  const backendRecentQueries = (zero?.recent_searches || []).filter((x) => typeof x === "string" && x.trim());

  // Prefer backend recent_searches if it starts getting populated later; else use localStorage recents
  const recentForUI =
    backendRecentQueries.length > 0
      ? backendRecentQueries.map((s) => ({ q: normalizeSpace(s), cityId: cityId || null, ts: 0 }))
      : localRecentQueries;

  const zeroTrending = zero?.trending_searches || [];
  const zeroLocalities = zero?.trending_localities || [];

  const groups = suggest?.groups;
  const hasSuggestResults =
    !!groups && (groups.locations.length + groups.projects.length + groups.builders.length + groups.rate_pages.length + groups.property_pdps.length) > 0;

  return (
    <div ref={boxRef} className="w-full">
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <select
          className="h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-sm"
          value={cityId}
          onChange={(e) => setCityId(e.target.value)}
          onFocus={() => setOpen(true)}
        >
          <option value="">All Cities</option>
          <option value="city_pune">Pune</option>
          <option value="city_noida">Noida</option>
        </select>

        <input
          className="h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm outline-none"
          placeholder="Search city, locality, project, builder, rates, properties..."
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />

        <button
          type="submit"
          className="h-10 rounded-lg border border-white/10 bg-white/10 px-4 text-sm hover:bg-white/15"
        >
          Search
        </button>
      </form>

      {open && (
        <div className="mt-2 rounded-xl border border-white/10 bg-black/60 backdrop-blur p-2">
          {loading && <div className="px-3 py-2 text-xs opacity-60">Loading…</div>}
          {errMsg && <div className="px-3 py-2 text-xs text-red-300">{errMsg}</div>}

          {/* Empty query => Zero state + Recents */}
          {!qTrim && (
            <>
              {recentForUI.length > 0 && (
                <div className="mb-2">
                  <div className="px-3 py-1 text-xs font-semibold opacity-60">Recent searches</div>
                  <div className="flex flex-wrap gap-2 px-3 pb-2">
                    {recentForUI.map((x, idx) => (
                      <button
                        key={`${x.q}-${x.ts}-${idx}`}
                        type="button"
                        onClick={() => goResolve(x.q)}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs hover:bg-white/10"
                      >
                        {x.q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {zeroTrending.length > 0 && (
                <div className="mb-2">
                  <div className="px-3 py-1 text-xs font-semibold opacity-60">Trending</div>
                  <div className="grid gap-2 px-2 pb-2">
                    {zeroTrending.map((it) => (
                      <button
                        key={`${it.id}-${it.entity_type}`}
                        type="button"
                        onClick={() => router.push(it.canonical_url)}
                        className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10"
                      >
                        <span className="w-10 shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold opacity-80">
                          {badgeForEntityType(it.entity_type)}
                        </span>
                        <span className="flex flex-col">
                          <span className="text-sm font-semibold">{it.name}</span>
                          <span className="text-xs opacity-60">
                            {(it.entity_type || "").replace(/_/g, " ")}
                            {it.city ? ` • ${it.city}` : ""}
                            {it.parent_name ? ` • ${it.parent_name}` : ""}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {zeroLocalities.length > 0 && (
                <div>
                  <div className="px-3 py-1 text-xs font-semibold opacity-60">Popular localities</div>
                  <div className="grid gap-2 px-2 pb-2">
                    {zeroLocalities.map((it) => (
                      <button
                        key={`${it.id}-${it.entity_type}`}
                        type="button"
                        onClick={() => router.push(it.canonical_url)}
                        className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10"
                      >
                        <span className="w-10 shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold opacity-80">
                          {badgeForEntityType(it.entity_type)}
                        </span>
                        <span className="flex flex-col">
                          <span className="text-sm font-semibold">{it.name}</span>
                          <span className="text-xs opacity-60">
                            {(it.entity_type || "").replace(/_/g, " ")}
                            {it.city ? ` • ${it.city}` : ""}
                            {it.parent_name ? ` • ${it.parent_name}` : ""}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Non-empty query => Suggest */}
          {!!qTrim && (
            <>
              {suggest?.did_you_mean && (
                <div className="px-3 py-2 text-xs opacity-70">
                  Did you mean{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      setQ(suggest.did_you_mean || "");
                      setOpen(true);
                    }}
                  >
                    {suggest.did_you_mean}
                  </button>
                  ?
                </div>
              )}

              {hasSuggestResults ? (
                <div className="grid gap-2 px-2 pb-2">
                  {(["locations", "projects", "builders", "rate_pages", "property_pdps"] as const).map((k) =>
                    (groups?.[k] || []).map((it: EntityOut) => (
                      <button
                        key={`${k}-${it.id}`}
                        type="button"
                        onClick={() => router.push(it.canonical_url)}
                        className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10"
                      >
                        <span className="w-10 shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold opacity-80">
                          {badgeForEntityType(it.entity_type)}
                        </span>
                        <span className="flex flex-col">
                          <span className="text-sm font-semibold">{it.name}</span>
                          <span className="text-xs opacity-60">
                            {(it.entity_type || "").replace(/_/g, " ")}
                            {it.city ? ` • ${it.city}` : ""}
                            {it.parent_name ? ` • ${it.parent_name}` : ""}
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <div className="px-3 py-2 text-xs opacity-60">No matches. Press Enter to search.</div>
              )}

              {showSeeAll && (
                <button
                  type="button"
                  onClick={() =>
                    router.push(`/search?q=${encodeURIComponent(qTrim)}${cityId ? `&city_id=${encodeURIComponent(cityId)}` : ""}`)
                  }
                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-xs hover:bg-white/10"
                >
                  See all results for “{qTrim}”
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
