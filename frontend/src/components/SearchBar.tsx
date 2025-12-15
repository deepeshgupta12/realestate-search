"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "../lib/api";

type EntityOut = {
  id: string;
  entity_type: string;
  name: string;
  city?: string;
  city_id?: string;
  parent_name?: string;
  canonical_url: string;
  score?: number | null;
  popularity_score?: number | null;
};

type SuggestResponse = {
  q: string;
  normalized_q: string;
  did_you_mean?: string | null;
  groups: Record<string, EntityOut[]>;
  fallbacks?: {
    relaxed_used?: boolean;
    trending?: EntityOut[];
    reason?: string | null;
  };
};

type ResolveResponse = {
  action: "redirect" | "serp";
  query: string;
  normalized_query: string;
  url?: string | null;
  match?: EntityOut | null;
  reason?: string | null;
  debug?: Record<string, any> | null;
};

type RecentQuery = {
  q: string;
  cityId?: string;
  ts: number;
};

function normalizeSpace(s: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function badgeForEntityType(t: string) {
  const m: Record<string, string> = {
    city: "CITY",
    micromarket: "MM",
    locality: "LOC",
    project: "PRJ",
    builder: "BLD",
    developer: "BLD",
    rate_page: "RATE",
    property_pdp: "PROP",
    listing_page: "LIST",
    locality_overview: "LOC",
  };
  return m[t] || t.toUpperCase().slice(0, 4);
}

const RECENTS_KEY = "re_search_recents_v1";

function loadRecents(): RecentQuery[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as RecentQuery[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.q === "string" && typeof x.ts === "number")
      .slice(0, 8);
  } catch {
    return [];
  }
}

function saveRecents(items: RecentQuery[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(items.slice(0, 8)));
  } catch {
    // ignore
  }
}

export default function SearchBar({ initialQuery = "", initialCityId = "" }: { initialQuery?: string; initialCityId?: string }) {
  const router = useRouter();

  const [q, setQ] = React.useState<string>(initialQuery);
  const [cityId, setCityId] = React.useState<string>(initialCityId);

  const [open, setOpen] = React.useState<boolean>(false);
  const [loading, setLoading] = React.useState<boolean>(false);

  const [suggest, setSuggest] = React.useState<SuggestResponse | null>(null);

  const [trendingLoading, setTrendingLoading] = React.useState<boolean>(false);
  const [trending, setTrending] = React.useState<EntityOut[]>([]);

  const [recents, setRecents] = React.useState<RecentQuery[]>([]);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const qTrim = normalizeSpace(q);

  // Load recents once on mount
  React.useEffect(() => {
    setRecents(loadRecents());
  }, []);

  // Close dropdown on outside click
  React.useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const el = containerRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  async function fetchTrending(city_id: string) {
    setTrendingLoading(true);
    try {
      const res = await apiGet<{ city_id?: string; items: EntityOut[] }>("/api/v1/search/trending", {
        city_id: city_id || undefined,
        limit: 8,
      });
      setTrending(res.items || []);
    } catch {
      setTrending([]);
    } finally {
      setTrendingLoading(false);
    }
  }

  // When dropdown opens and query empty -> load trending
  React.useEffect(() => {
    if (!open) return;
    if (qTrim) return;
    fetchTrending(cityId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, qTrim, cityId]);

  // Debounced suggest fetch when query exists
  React.useEffect(() => {
    if (!open) return;
    if (!qTrim) {
      setSuggest(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const t = window.setTimeout(async () => {
      try {
        const res = await apiGet<SuggestResponse>("/api/v1/search/suggest", {
          q: qTrim,
          city_id: cityId || undefined,
          limit: 10,
        });
        if (!cancelled) setSuggest(res);
      } catch {
        if (!cancelled) setSuggest(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [qTrim, cityId, open]);

  function pushRecent(query: string) {
    const item: RecentQuery = { q: query, cityId: cityId || undefined, ts: Date.now() };

    const current = loadRecents();
    // de-dupe by (q + cityId)
    const key = `${item.q}::${item.cityId || ""}`;
    const next = [item, ...current.filter((r) => `${r.q}::${r.cityId || ""}` !== key)].slice(0, 8);

    saveRecents(next);
    setRecents(next);
  }

  function goToSerp(query: string) {
    const url = `/search?q=${encodeURIComponent(query)}${cityId ? `&city_id=${encodeURIComponent(cityId)}` : ""}`;
    router.push(url);
    setOpen(false);
  }

  function goToGo(targetUrl: string, query?: string) {
    // In your demo app, we route through /go to show the final destination; keep it consistent
    const u = `/go?url=${encodeURIComponent(targetUrl)}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
    router.push(u);
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
      <button key={e.id} type="button" className="item" onClick={() => goToGo(e.canonical_url, qTrim)}>
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
              {qTrim ? (
                <button type="button" className="seeAll" onClick={() => goToSerp(qTrim)}>
                  See all results for "{qTrim}"
                </button>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}