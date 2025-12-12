"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type EntityType =
  | "city"
  | "micromarket"
  | "locality"
  | "listing_page"
  | "locality_overview"
  | "rate_page"
  | "project"
  | "builder"
  | "developer"
  | "property_pdp"
  | string;

type EntityOut = {
  id: string;
  entity_type: EntityType;
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
  did_you_mean: string | null;
  groups: {
    locations: EntityOut[];
    projects: EntityOut[];
    builders: EntityOut[];
    rate_pages: EntityOut[];
    property_pdps: EntityOut[];
    [k: string]: EntityOut[];
  };
  fallbacks?: {
    relaxed_used?: boolean;
    trending?: EntityOut[];
    reason?: string | null;
  } | null;
};

type ResolveResponse = {
  action: "redirect" | "serp";
  query: string;
  normalized_query: string;
  url?: string | null;
  match?: EntityOut | null;
  reason?: string | null;
  debug?: any;
};

type TrendingResponse = {
  city_id: string | null;
  items: EntityOut[];
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") || "http://localhost:8000";

const RECENTS_KEY = "re_search_recent_v1";
const MAX_RECENTS = 8;

function safeJsonParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function getRecents(): string[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(RECENTS_KEY);
  if (!raw) return [];
  const arr = safeJsonParse<string[]>(raw, []);
  return Array.isArray(arr) ? arr.filter(Boolean) : [];
}

function addRecent(q: string) {
  if (typeof window === "undefined") return;
  const s = q.trim();
  if (!s) return;
  const prev = getRecents();
  const next = [s, ...prev.filter((x) => x.toLowerCase() !== s.toLowerCase())].slice(0, MAX_RECENTS);
  window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
}

function groupsEmpty(groups: SuggestResponse["groups"] | null | undefined): boolean {
  if (!groups) return true;
  const keys = Object.keys(groups);
  for (const k of keys) {
    if (Array.isArray(groups[k]) && groups[k].length > 0) return false;
  }
  return true;
}

export default function SearchBar() {
  const router = useRouter();

  const [q, setQ] = useState("");
  const [cityId, setCityId] = useState<string>(""); // optional; keep empty if not used
  const [open, setOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [suggest, setSuggest] = useState<SuggestResponse | null>(null);
  const [trending, setTrending] = useState<EntityOut[]>([]);
  const [recents, setRecents] = useState<string[]>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const trimmed = q.trim();
  const hasQuery = trimmed.length > 0;

  const didYouMean = useMemo(() => {
    const d = suggest?.did_you_mean;
    if (!d) return null;
    if (d.toLowerCase() === trimmed.toLowerCase()) return null;
    return d;
  }, [suggest, trimmed]);

  const showNoResultsTypingOnly = useMemo(() => {
    if (!hasQuery) return false;
    if (!suggest) return false;
    return groupsEmpty(suggest.groups);
  }, [hasQuery, suggest]);

  const showSeeAll = useMemo(() => {
    return hasQuery; // only when user typed something
  }, [hasQuery]);

  // Close dropdown on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Load recents once
  useEffect(() => {
    setRecents(getRecents());
  }, []);

  // Fetch trending (for empty query dropdown)
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const url =
          `${API_BASE}/api/v1/search/trending?limit=8` + (cityId ? `&city_id=${encodeURIComponent(cityId)}` : "");
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as TrendingResponse;
        if (!cancelled) setTrending(data.items || []);
      } catch {
        // ignore
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [cityId]);

  // Suggest as user types
  useEffect(() => {
    // cancel previous
    abortRef.current?.abort();
    abortRef.current = null;

    if (!open) return;

    if (!hasQuery) {
      setSuggest(null);
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;

    const run = async () => {
      setLoading(true);
      try {
        const url =
          `${API_BASE}/api/v1/search/suggest?q=${encodeURIComponent(trimmed)}&limit=10` +
          (cityId ? `&city_id=${encodeURIComponent(cityId)}` : "");
        const r = await fetch(url, { signal: ac.signal, cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as SuggestResponse;
        setSuggest(data);
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          // ignore
        }
      } finally {
        setLoading(false);
      }
    };

    const t = window.setTimeout(run, 150);
    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
  }, [API_BASE, trimmed, cityId, open, hasQuery]);

  // Prevent body scroll when scrolling inside dropdown
  useEffect(() => {
    const dd = dropdownRef.current;
    if (!dd) return;

    const onWheel = (e: WheelEvent) => {
      const el = dropdownRef.current;
      if (!el) return;

      // allow scroll in dropdown, but prevent page scroll bleed
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      const goingUp = e.deltaY < 0;
      const goingDown = e.deltaY > 0;

      if ((atTop && goingUp) || (atBottom && goingDown)) {
        e.preventDefault();
      }
      e.stopPropagation();
    };

    dd.addEventListener("wheel", onWheel, { passive: false });
    return () => dd.removeEventListener("wheel", onWheel as any);
  }, [open]);

  async function goResolve(input: string) {
    const qq = input.trim();
    if (!qq) return;

    addRecent(qq);
    setRecents(getRecents());

    // Call resolve so backend decides redirect vs SERP
    const url =
      `${API_BASE}/api/v1/search/resolve?q=${encodeURIComponent(qq)}` +
      (cityId ? `&city_id=${encodeURIComponent(cityId)}` : "");

    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      router.push(`/search?q=${encodeURIComponent(qq)}${cityId ? `&city_id=${encodeURIComponent(cityId)}` : ""}`);
      return;
    }

    const data = (await r.json()) as ResolveResponse;

    if (data.action === "redirect" && data.url) {
      setOpen(false);
      router.push(data.url);
      return;
    }

    // serp
    const serpUrl =
      data.url ||
      `/search?q=${encodeURIComponent(qq)}${cityId ? `&city_id=${encodeURIComponent(cityId)}` : ""}`;

    setOpen(false);
    router.push(serpUrl);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed) return;
    void goResolve(trimmed);
  }

  function onPickEntity(e: EntityOut) {
    addRecent(e.name || trimmed);
    setRecents(getRecents());
    setOpen(false);
    router.push(e.canonical_url);
  }

  function renderEntityRow(e: EntityOut) {
    const meta = [e.parent_name, e.city].filter(Boolean).join(" • ");
    return (
      <button
        key={e.id}
        type="button"
        onClick={() => onPickEntity(e)}
        className="w-full text-left px-3 py-2 hover:bg-black/5"
      >
        <div className="text-sm font-medium">{e.name}</div>
        {meta ? <div className="text-xs opacity-70">{meta}</div> : null}
      </button>
    );
  }

  const groups = suggest?.groups;

  return (
    <div ref={containerRef} className="relative w-full max-w-2xl">
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search city, locality, project, builder..."
          className="w-full rounded-md border px-3 py-2 outline-none"
        />

        <button
          type="submit"
          className="rounded-md border px-4 py-2 font-medium"
          disabled={!trimmed}
        >
          Search
        </button>
      </form>

      {open ? (
        <div
          ref={dropdownRef}
          className="absolute left-0 right-0 z-50 mt-2 rounded-md border bg-white shadow-lg"
          style={{
            maxHeight: "360px",
            overflowY: "auto",
            overscrollBehavior: "contain",
          }}
        >
          {/* Did you mean */}
          {didYouMean ? (
            <div className="px-3 py-2 text-sm border-b">
              Did you mean{" "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setQ(didYouMean);
                  void goResolve(didYouMean);
                }}
              >
                {didYouMean}
              </button>
              ?
            </div>
          ) : null}

          {/* Loading */}
          {loading ? (
            <div className="px-3 py-3 text-sm opacity-70">Searching…</div>
          ) : null}

          {/* Empty query: show recents + trending */}
          {!hasQuery ? (
            <div className="py-2">
              {recents.length > 0 ? (
                <div className="pb-2">
                  <div className="px-3 py-1 text-xs font-semibold opacity-60">Recent searches</div>
                  {recents.map((x) => (
                    <button
                      key={x}
                      type="button"
                      onClick={() => void goResolve(x)}
                      className="w-full text-left px-3 py-2 hover:bg-black/5"
                    >
                      <div className="text-sm">{x}</div>
                    </button>
                  ))}
                </div>
              ) : null}

              <div>
                <div className="px-3 py-1 text-xs font-semibold opacity-60">Trending</div>
                {trending.length === 0 ? (
                  <div className="px-3 py-2 text-sm opacity-70">No trending items yet.</div>
                ) : (
                  trending.map(renderEntityRow)
                )}
              </div>
            </div>
          ) : null}

          {/* Non-empty query */}
          {hasQuery ? (
            <div className="py-2">
              {/* No results found (while typing) */}
              {showNoResultsTypingOnly ? (
                <div className="px-3 py-2">
                  <div className="text-sm font-medium">No results found</div>
                  <div className="text-xs opacity-70">Try a different spelling, or search anyway.</div>

                  {/* Optional: show trending suggestions below */}
                  {trending.length > 0 ? (
                    <div className="mt-3">
                      <div className="text-xs font-semibold opacity-60 mb-1">Trending</div>
                      <div className="rounded border">
                        {trending.slice(0, 6).map(renderEntityRow)}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Results groups */}
              {!showNoResultsTypingOnly && groups ? (
                <div>
                  {groups.locations?.length ? (
                    <div className="pb-2">
                      <div className="px-3 py-1 text-xs font-semibold opacity-60">Locations</div>
                      {groups.locations.map(renderEntityRow)}
                    </div>
                  ) : null}

                  {groups.projects?.length ? (
                    <div className="pb-2">
                      <div className="px-3 py-1 text-xs font-semibold opacity-60">Projects</div>
                      {groups.projects.map(renderEntityRow)}
                    </div>
                  ) : null}

                  {groups.builders?.length ? (
                    <div className="pb-2">
                      <div className="px-3 py-1 text-xs font-semibold opacity-60">Builders</div>
                      {groups.builders.map(renderEntityRow)}
                    </div>
                  ) : null}

                  {groups.rate_pages?.length ? (
                    <div className="pb-2">
                      <div className="px-3 py-1 text-xs font-semibold opacity-60">Property Rates</div>
                      {groups.rate_pages.map(renderEntityRow)}
                    </div>
                  ) : null}

                  {groups.property_pdps?.length ? (
                    <div className="pb-2">
                      <div className="px-3 py-1 text-xs font-semibold opacity-60">Properties</div>
                      {groups.property_pdps.map(renderEntityRow)}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* See all results */}
              {showSeeAll ? (
                <div className="border-t mt-2">
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm font-medium hover:bg-black/5"
                    onClick={() => void goResolve(trimmed)}
                  >
                    See all results for “{trimmed}”
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
