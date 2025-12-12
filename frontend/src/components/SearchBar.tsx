// frontend/components/SearchBox.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";

type Entity = {
  id: string;
  entity_type: string;
  name: string;
  city?: string;
  city_id?: string;
  parent_name?: string;
  canonical_url: string;
  score?: number;
  popularity_score?: number;
};

type SuggestResponse = {
  q: string;
  normalized_q: string;
  did_you_mean: string | null;
  groups: {
    locations: Entity[];
    projects: Entity[];
    builders: Entity[];
    rate_pages: Entity[];
    property_pdps: Entity[];
  };
  fallbacks?: {
    relaxed_used: boolean;
    trending: Entity[];
    reason: string | null;
  };
};

type ResolveResponse =
  | { action: "redirect"; url: string; query: string; normalized_query?: string }
  | { action: "serp"; url: null; query: string; normalized_query?: string; reason?: string };

type TrendingResponse = { city_id: string | null; items: Entity[] };

const RECENT_KEY = "re_recent_searches_v1";

function pushRecent(q: string, cityId: string | null) {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr: { q: string; city_id: string | null; ts: number }[] = raw ? JSON.parse(raw) : [];
    const next = [{ q, city_id: cityId, ts: Date.now() }, ...arr.filter(x => x.q !== q)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
}

function readRecent(): { q: string; city_id: string | null; ts: number }[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export default function SearchBox() {
  const router = useRouter();

  const [q, setQ] = useState("");
  const [cityId, setCityId] = useState<string>(""); // empty = all cities
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [suggest, setSuggest] = useState<SuggestResponse | null>(null);
  const [trending, setTrending] = useState<Entity[]>([]);
  const [recent, setRecent] = useState<{ q: string; city_id: string | null }[]>([]);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const normalizedCityId = cityId.trim();

  // Debounce suggest calls
  const debouncedQ = useMemo(() => q.trim(), [q]);

  useEffect(() => {
    // recent on mount
    const r = readRecent().map(x => ({ q: x.q, city_id: x.city_id }));
    setRecent(r);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadTrending() {
      try {
        const resp = await apiGet<TrendingResponse>("/api/v1/search/trending", {
          limit: 8,
          city_id: normalizedCityId || null,
        });
        if (!cancelled) setTrending(resp.items || []);
      } catch {
        if (!cancelled) setTrending([]);
      }
    }

    // When input is empty, show trending + recent
    if (!debouncedQ) {
      setSuggest(null);
      loadTrending();
      return () => {
        cancelled = true;
      };
    }

    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const resp = await apiGet<SuggestResponse>("/api/v1/search/suggest", {
          q: debouncedQ,
          limit: 10,
          city_id: normalizedCityId || null,
        });
        if (!cancelled) setSuggest(resp);
      } catch {
        if (!cancelled) setSuggest(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [debouncedQ, normalizedCityId]);

  // Close dropdown on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function goToSERP(query: string) {
    pushRecent(query, normalizedCityId || null);
    const params = new URLSearchParams();
    params.set("q", query);
    if (normalizedCityId) params.set("city_id", normalizedCityId);
    router.push(`/search?${params.toString()}`);
    setOpen(false);
  }

  function goToRedirect(query: string, url: string) {
    pushRecent(query, normalizedCityId || null);
    const params = new URLSearchParams();
    params.set("q", query);
    params.set("url", url);
    router.push(`/go?${params.toString()}`);
    setOpen(false);
  }

  async function onSubmit() {
    const query = q.trim();
    if (!query) return;

    setLoading(true);
    try {
      const resp = await apiGet<ResolveResponse>("/api/v1/search/resolve", {
        q: query,
        city_id: normalizedCityId || null,
      });

      if (resp.action === "redirect" && resp.url) {
        goToRedirect(query, resp.url);
      } else {
        goToSERP(query);
      }
    } catch {
      // If resolve fails, fall back to SERP
      goToSERP(query);
    } finally {
      setLoading(false);
    }
  }

  function renderEntityRow(e: Entity) {
    const subtitle = [e.entity_type, e.city ? `• ${e.city}` : "", e.parent_name ? `• ${e.parent_name}` : ""]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        key={e.id}
        className="w-full text-left px-3 py-2 hover:bg-white/10"
        onClick={() => goToRedirect(q.trim() || e.name, e.canonical_url)}
        type="button"
      >
        <div className="font-medium">{e.name}</div>
        <div className="text-xs opacity-70">{subtitle}</div>
      </button>
    );
  }

  const groups = suggest?.groups;
  const totalResults =
    (groups?.locations?.length || 0) +
    (groups?.projects?.length || 0) +
    (groups?.builders?.length || 0) +
    (groups?.rate_pages?.length || 0) +
    (groups?.property_pdps?.length || 0);

  const showNoResults = !!debouncedQ && suggest && totalResults === 0;

  return (
    <div className="relative max-w-3xl mx-auto" ref={panelRef}>
      <div className="flex gap-2 items-center">
        <select
          className="bg-white/5 border border-white/15 rounded-md px-2 py-2 text-sm"
          value={cityId}
          onChange={(e) => setCityId(e.target.value)}
        >
          <option value="">All Cities</option>
          <option value="city_pune">Pune</option>
          <option value="city_noida">Noida</option>
        </select>

        <input
          ref={inputRef}
          className="flex-1 bg-white/5 border border-white/15 rounded-md px-3 py-2"
          placeholder="Search city, locality, project, builder, rates, properties..."
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
            if (e.key === "Escape") setOpen(false);
          }}
        />

        <button
          className="bg-white/10 border border-white/15 rounded-md px-4 py-2"
          onClick={onSubmit}
          type="button"
          disabled={loading}
        >
          {loading ? "..." : "Search"}
        </button>
      </div>

      {open && (
        <div
          className="absolute left-0 right-0 mt-2 bg-[#14161a] border border-white/15 rounded-lg overflow-hidden z-50"
          style={{
            // fixes: dropdown must be fully visible + scroll inside panel only
            maxHeight: "420px",
            overflowY: "auto",
            overscrollBehavior: "contain",
          }}
          onWheel={(e) => {
            // Prevent page scroll when wheel happens on panel
            e.stopPropagation();
          }}
        >
          {/* Empty query: show recent + trending */}
          {!debouncedQ && (
            <div className="py-2">
              {recent.length > 0 && (
                <div className="px-3 py-2 text-xs opacity-70">Recent searches</div>
              )}
              {recent.map((r, idx) => (
                <button
                  key={`${r.q}-${idx}`}
                  className="w-full text-left px-3 py-2 hover:bg-white/10"
                  onClick={() => {
                    setQ(r.q);
                    inputRef.current?.focus();
                  }}
                  type="button"
                >
                  <div className="font-medium">{r.q}</div>
                  <div className="text-xs opacity-70">{r.city_id ? r.city_id : "All Cities"}</div>
                </button>
              ))}

              <div className="px-3 py-2 text-xs opacity-70 border-t border-white/10 mt-2">Trending</div>
              {trending.map((e) => renderEntityRow(e))}
            </div>
          )}

          {/* Typed query: show suggestions */}
          {!!debouncedQ && (
            <div className="py-2">
              {suggest?.did_you_mean && (
                <div className="px-3 py-2 text-sm">
                  Did you mean{" "}
                  <button
                    className="underline underline-offset-2"
                    type="button"
                    onClick={() => setQ(suggest.did_you_mean || "")}
                  >
                    {suggest.did_you_mean}
                  </button>
                  ?
                </div>
              )}

              {!showNoResults && (
                <>
                  {groups?.locations?.length ? (
                    <>
                      <div className="px-3 py-2 text-xs opacity-70">Locations</div>
                      {groups.locations.map(renderEntityRow)}
                    </>
                  ) : null}

                  {groups?.projects?.length ? (
                    <>
                      <div className="px-3 py-2 text-xs opacity-70 border-t border-white/10">Projects</div>
                      {groups.projects.map(renderEntityRow)}
                    </>
                  ) : null}

                  {groups?.builders?.length ? (
                    <>
                      <div className="px-3 py-2 text-xs opacity-70 border-t border-white/10">Builders</div>
                      {groups.builders.map(renderEntityRow)}
                    </>
                  ) : null}

                  {groups?.rate_pages?.length ? (
                    <>
                      <div className="px-3 py-2 text-xs opacity-70 border-t border-white/10">Property Rates</div>
                      {groups.rate_pages.map(renderEntityRow)}
                    </>
                  ) : null}

                  {groups?.property_pdps?.length ? (
                    <>
                      <div className="px-3 py-2 text-xs opacity-70 border-t border-white/10">Properties</div>
                      {groups.property_pdps.map(renderEntityRow)}
                    </>
                  ) : null}
                </>
              )}

              {showNoResults && (
                <div className="py-2">
                  <div className="px-3 py-2 font-medium">No results found</div>
                  <div className="px-3 pb-2 text-sm opacity-70">Try a different spelling or choose from trending.</div>
                  <div className="px-3 py-2 text-xs opacity-70">Trending</div>
                  {(suggest?.fallbacks?.trending || trending).map(renderEntityRow)}
                </div>
              )}

              <div className="border-t border-white/10 mt-2">
                <button
                  className="w-full text-left px-3 py-3 hover:bg-white/10 font-medium"
                  type="button"
                  onClick={() => goToSERP(q.trim())}
                >
                  See all results for "{q.trim()}"
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}