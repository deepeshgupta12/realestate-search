"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import type {ResolveResponse, SuggestResponse } from "@/lib/types";

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

function safeParseRecents(raw: string | null): RecentSearch[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);

    // v0 migration: array of strings
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      const now = Date.now();
      return parsed
        .map((q: string, i: number) => ({ q: normalizeSpace(q), cityId: null, ts: now - i }))
        .filter((x) => x.q);
    }

    // v1: array of objects
    if (Array.isArray(parsed)) {
      const out: RecentSearch[] = [];
      for (const item of parsed) {
        if (item && typeof item === "object") {
          const q = typeof (item as any).q === "string" ? normalizeSpace((item as any).q) : "";
          const cityId =
            typeof (item as any).cityId === "string"
              ? (item as any).cityId
              : (item as any).cityId === null
                ? null
                : undefined;
          const ts = typeof (item as any).ts === "number" ? (item as any).ts : Date.now();
          if (q) out.push({ q, cityId: cityId ?? null, ts });
        }
      }
      return out;
    }

    return [];
  } catch {
    return [];
  }
}

function writeRecents(recents: RecentSearch[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
  } catch {
    // ignore
  }
}

export default function SearchBar(props?: { initialQ?: string; initialCityId?: string }) {
  const router = useRouter();

  const [q, setQ] = useState<string>(props?.initialQ ?? "");
  const [cityId, setCityId] = useState<string>(props?.initialCityId ?? "");
  const [open, setOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [suggest, setSuggest] = useState<SuggestResponse | null>(null);

  const [trending, setTrending] = useState<EntityOut[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(false);

  const [recents, setRecents] = useState<RecentSearch[]>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const qTrim = useMemo(() => normalizeSpace(q), [q]);

  // Lock page scroll when dropdown is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Load recents on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const loaded = safeParseRecents(localStorage.getItem(RECENTS_KEY));
    setRecents(loaded);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  async function fetchTrending() {
    try {
      setTrendingLoading(true);
      const res = await apiGet<{ city_id?: string | null; items: EntityOut[] }>("/api/v1/search/trending", {
        city_id: cityId || undefined,
        limit: 8,
      });
      setTrending(res.items || []);
    } catch {
      setTrending([]);
    } finally {
      setTrendingLoading(false);
    }
  }

  async function fetchSuggest(query: string) {
    setLoading(true);
    try {
      const res = await apiGet<SuggestResponse>("/api/v1/search/suggest", {
        q: query,
        city_id: cityId || undefined,
        limit: 10,
      });
      setSuggest(res);
    } catch {
      setSuggest(null);
    } finally {
      setLoading(false);
    }
  }

  // Whenever dropdown opens, load trending if q is empty
  useEffect(() => {
    if (!open) return;
    if (!qTrim) {
      fetchTrending();
      setSuggest(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cityId]);

  // Debounce suggest fetch
  useEffect(() => {
    if (!open) return;

    if (!qTrim) {
      setSuggest(null);
      return;
    }

    const t = setTimeout(() => {
      fetchSuggest(qTrim);
    }, 180);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qTrim, cityId, open]);

  function pushRecent(query: string) {
    const cleaned = normalizeSpace(query);
    if (!cleaned) return;

    const now = Date.now();
    const next: RecentSearch[] = [
      { q: cleaned, cityId: cityId || null, ts: now },
      ...recents.filter((r) => !(normalizeSpace(r.q).toLowerCase() === cleaned.toLowerCase() && (r.cityId || "") === (cityId || ""))),
    ].slice(0, MAX_RECENTS);

    setRecents(next);
    writeRecents(next);
  }

  function goToSerp(query: string) {
    const cleaned = normalizeSpace(query);
    if (!cleaned) return;

    pushRecent(cleaned);

    const params = new URLSearchParams();
    params.set("q", cleaned);
    if (cityId) params.set("city_id", cityId);

    router.push(`/search?${params.toString()}`);
    setOpen(false);
  }

  function goToGo(url: string, query?: string) {
    const params = new URLSearchParams();
    params.set("url", url);
    if (query && normalizeSpace(query)) params.set("q", normalizeSpace(query));
    router.push(`/go?${params.toString()}`);
    setOpen(false);
  }

  async function onSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const cleaned = normalizeSpace(q);
    if (!cleaned) return;

    pushRecent(cleaned);

    try {
      const res = await apiGet<ResolveResponse>("/api/v1/search/resolve", { q: cleaned });

      // redirect action
      if (res.action === "redirect" && res.url) {
        goToGo(res.url, cleaned);
        return;
      }

      // serp action - backend now returns a serp url for constraint-heavy queries
      if (res.action === "serp" && res.url) {
        router.push(res.url);
        setOpen(false);
        return;
      }

      // fallback
      goToSerp(cleaned);
    } catch {
      goToSerp(cleaned);
    }
  }

  function renderEntityRow(e: EntityOut) {
    const badge = badgeForEntityType(e.entity_type);
    const metaParts = [e.entity_type, e.city, e.parent_name].filter(Boolean);

    return (
      <button
        key={e.id}
        type="button"
        className="item"
        onClick={() => goToGo(e.canonical_url, qTrim)}
      >
        <div className="itemLeft">
          <span className="badge">{badge}</span>
        </div>
        <div className="itemBody">
          <div className="itemTitle">{e.name}</div>
          <div className="itemMeta">{metaParts.join(" • ")}</div>
        </div>
      </button>
    );
  }

  const groups = suggest?.groups;

  return (
    <div ref={containerRef} className="searchWrap">
      <form className="searchRow" onSubmit={onSubmit}>
        <select className="select" value={cityId} onChange={(e) => setCityId(e.target.value)}>
          <option value="">All Cities</option>
          <option value="city_noida">Noida</option>
          <option value="city_pune">Pune</option>
        </select>

        <input
          ref={inputRef}
          className="input"
          value={q}
          placeholder="Search city, locality, project, builder, rates, properties..."
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
        />

        <button className="btn" type="submit">
          Search
        </button>
      </form>

      {open && (
        <div className="dropdown" role="listbox" aria-label="Search suggestions">
          {/* When query is empty => Trending + Recents */}
          {!qTrim && (
            <>
              <div className="sectionTitle">Trending</div>
              {trendingLoading ? (
                <div className="empty">Loading…</div>
              ) : trending.length === 0 ? (
                <div className="empty">No trending items.</div>
              ) : (
                <div className="list">{trending.map(renderEntityRow)}</div>
              )}

              {recents.length > 0 && (
                <>
                  <div className="sectionTitle">Recent searches</div>
                  <div className="list">
                    {recents.map((r, idx) => (
                      <button
                        key={`${r.q}|${r.cityId || ""}|${r.ts}|${idx}`}
                        type="button"
                        className="item"
                        onClick={() => {
                          setQ(r.q);
                          if (r.cityId) setCityId(r.cityId);
                          goToSerp(r.q);
                        }}
                      >
                        <div className="itemLeft">
                          <span className="badge">REC</span>
                        </div>
                        <div className="itemBody">
                          <div className="itemTitle">{r.q}</div>
                          <div className="itemMeta">{r.cityId ? `city_id • ${r.cityId}` : "All Cities"}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {/* When query exists => suggestions */}
          {qTrim && (
            <>
              {loading && <div className="empty">Searching…</div>}

              {!loading && suggest?.did_you_mean && suggest.did_you_mean !== suggest.q && (
                <div className="dym">
                  Did you mean{" "}
                  <button type="button" className="dymBtn" onClick={() => setQ(suggest.did_you_mean || "")}>
                    {suggest.did_you_mean}
                  </button>
                  ?
                </div>
              )}

              {!loading && groups && (
                <>
                  {groups.locations?.length > 0 && (
                    <>
                      <div className="sectionTitle">Locations</div>
                      <div className="list">{groups.locations.map(renderEntityRow)}</div>
                    </>
                  )}

                  {groups.projects?.length > 0 && (
                    <>
                      <div className="sectionTitle">Projects</div>
                      <div className="list">{groups.projects.map(renderEntityRow)}</div>
                    </>
                  )}

                  {groups.builders?.length > 0 && (
                    <>
                      <div className="sectionTitle">Builders</div>
                      <div className="list">{groups.builders.map(renderEntityRow)}</div>
                    </>
                  )}

                  {groups.rate_pages?.length > 0 && (
                    <>
                      <div className="sectionTitle">Property Rates</div>
                      <div className="list">{groups.rate_pages.map(renderEntityRow)}</div>
                    </>
                  )}

                  {groups.property_pdps?.length > 0 && (
                    <>
                      <div className="sectionTitle">Properties</div>
                      <div className="list">{groups.property_pdps.map(renderEntityRow)}</div>
                    </>
                  )}

                  {Object.values(groups).every((arr) => !arr || arr.length === 0) && (
                    <div className="empty">No results found. Try a different spelling or choose from trending.</div>
                  )}
                </>
              )}

              {/* IMPORTANT: do NOT show this when q is empty */}
              <button type="button" className="seeAll" onClick={() => goToSerp(qTrim)}>
                See all results for "{qTrim}"
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}