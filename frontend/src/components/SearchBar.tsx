"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";

/** Minimal types (keeps this file compile-safe even if lib/types changes) */
type EntityType =
  | "city"
  | "micromarket"
  | "locality"
  | "locality_overview"
  | "project"
  | "builder"
  | "rate_page"
  | "property_pdp";

type EntityOut = {
  id: string;
  entity_type: EntityType;
  name: string;
  city?: string | null;
  city_id?: string | null;
  parent_name?: string | null;
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
  };
  fallbacks: {
    relaxed_used: boolean;
    trending: EntityOut[];
    reason: string | null;
  };
};

type ZeroStateResponse = {
  city_id: string | null;
  recent_searches: { q: string; ts: string }[];
  trending_searches: EntityOut[];
  trending_localities: EntityOut[];
  popular_entities: EntityOut[];
};

type Props = {
  className?: string;
  /** pass current page path ("/", "/pune/baner", etc.). Defaults to "/" */
  contextUrl?: string;
  /** optional city scope (if you want to hard-lock city from parent page) */
  defaultCityId?: string | null;
};

function sp1(v: string | string[] | null | undefined): string {
  if (!v) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

function enc(v: string): string {
  return encodeURIComponent(v);
}

export default function SearchBar({ className, contextUrl = "/", defaultCityId = null }: Props) {
  const router = useRouter();

  const [q, setQ] = useState("");
  const [cityId, setCityId] = useState<string | null>(defaultCityId);
  const [open, setOpen] = useState(false);
  const [loadingSuggest, setLoadingSuggest] = useState(false);

  const [zero, setZero] = useState<ZeroStateResponse | null>(null);
  const [suggest, setSuggest] = useState<SuggestResponse | null>(null);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<number | null>(null);

  const hasQuery = q.trim().length > 0;

  const allGroups = useMemo(() => {
    if (!suggest) return [];
    const g = suggest.groups;
    return [
      { key: "locations", title: "Locations", items: g.locations },
      { key: "projects", title: "Projects", items: g.projects },
      { key: "builders", title: "Builders", items: g.builders },
      { key: "rate_pages", title: "Property Rates", items: g.rate_pages },
      { key: "property_pdps", title: "Properties", items: g.property_pdps },
    ].filter((x) => x.items.length > 0);
  }, [suggest]);

  function goToGoQuery(rawQuery: string) {
    const qq = rawQuery.trim();
    if (!qq) return;

    const url =
      `/go?q=${enc(qq)}` +
      (cityId ? `&city_id=${enc(cityId)}` : "") +
      `&context_url=${enc(contextUrl || "/")}`;

    setOpen(false);
    router.push(url);
  }

  function goToGoClick(args: {
    url: string;
    from_q?: string;
    entity_id?: string;
    entity_type?: string;
    rank?: number;
    city_id?: string | null;
  }) {
    const url =
      `/go?url=${enc(args.url)}` +
      (args.from_q ? `&from_q=${enc(args.from_q)}` : (suggest?.q ? `&from_q=${enc(suggest.q)}` : "")) +
      (args.entity_id ? `&entity_id=${enc(args.entity_id)}` : "") +
      (args.entity_type ? `&entity_type=${enc(args.entity_type)}` : "") +
      (typeof args.rank === "number" ? `&rank=${enc(String(args.rank))}` : "") +
      (args.city_id ? `&city_id=${enc(args.city_id)}` : (cityId ? `&city_id=${enc(cityId)}` : "")) +
      `&context_url=${enc(contextUrl || "/")}`;

    setOpen(false);
    router.push(url);
  }

  async function loadZeroState() {
    try {
      const path =
        `/search/zero-state?limit=8` + (cityId ? `&city_id=${enc(cityId)}` : "") + `&context_url=${enc(contextUrl || "/")}`;
      const res = await apiGet<ZeroStateResponse>(path);
      setZero(res);
    } catch {
      // ignore (zero state is optional UX)
    }
  }

  async function loadSuggest(query: string) {
    const qq = query.trim();
    if (!qq) {
      setSuggest(null);
      return;
    }

    try {
      setLoadingSuggest(true);
      const path =
        `/search/suggest?q=${enc(qq)}` +
        (cityId ? `&city_id=${enc(cityId)}` : "") +
        `&context_url=${enc(contextUrl || "/")}`;
      const res = await apiGet<SuggestResponse>(path);
      setSuggest(res);
    } catch {
      // swallow errors for UX
      setSuggest(null);
    } finally {
      setLoadingSuggest(false);
    }
  }

  useEffect(() => {
    // When we first open, load zero-state
    if (open && !hasQuery && !zero) {
      void loadZeroState();
    }
    // When query changes & dropdown is open, debounce suggest
    if (!open) return;
    if (!hasQuery) {
      setSuggest(null);
      return;
    }

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      loadSuggest(q);
    }, 120);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open, cityId, contextUrl, hasQuery, zero]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (boxRef.current && !boxRef.current.contains(t)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div className={className} ref={boxRef}>
      <div className="relative">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            goToGoQuery(q);
          }}
        >
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search city, locality, project, builder…"
            className="w-full rounded-xl border px-4 py-3 text-sm outline-none"
          />
        </form>

        {open && (
          <div className="absolute z-50 mt-2 w-full rounded-xl border bg-white shadow-lg">
            {!hasQuery && (
              <div className="p-3 space-y-4">
                {zero && zero.recent_searches && zero.recent_searches.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-600">Recent searches</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {zero.recent_searches.map((item, idx) => (
                        <button
                          key={`recent_${idx}`}
                          className="inline-flex items-center rounded-full border px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
                          onClick={() => goToGoQuery(item.q)}
                          type="button"
                        >
                          <span className="truncate">{item.q}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div className="text-xs font-semibold text-gray-600">Trending</div>
                  <div className="mt-2 space-y-1">
                    {(zero?.trending_searches || []).map((it, idx) => (
                      <button
                        key={`trend_${it.id}_${idx}`}
                        className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50"
                        onClick={() =>
                          goToGoClick({
                            url: it.canonical_url,
                            from_q: "",
                            entity_id: it.id,
                            entity_type: it.entity_type,
                            rank: idx + 1,
                            city_id: it.city_id ?? null,
                          })
                        }
                        type="button"
                      >
                        <div className="font-medium">{it.name}</div>
                        <div className="text-xs text-gray-500">
                          {(it.city || "").trim()}
                          {it.parent_name ? ` • ${it.parent_name}` : ""}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {hasQuery && (
              <div className="p-3">
                {loadingSuggest && <div className="text-xs text-gray-500">Searching…</div>}

                {suggest?.did_you_mean && (
                  <div className="mb-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                    Did you mean{" "}
                    <button
                      className="font-semibold underline"
                      onClick={() => goToGoQuery(suggest.did_you_mean || "")}
                      type="button"
                    >
                      {suggest.did_you_mean}
                    </button>
                    ?
                  </div>
                )}

                {allGroups.map((group) => (
                  <div key={group.key} className="mb-3 last:mb-0">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {group.title}
                    </div>
                    <div className="space-y-1">
                      {group.items.map((it, idx) => (
                        <button
                          key={`${group.key}_${it.id}_${idx}`}
                          className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50"
                          onClick={() =>
                            goToGoClick({
                              url: it.canonical_url,
                              entity_id: it.id,
                              entity_type: it.entity_type,
                              rank: idx + 1,
                              city_id: it.city_id ?? null,
                            })
                          }
                          type="button"
                        >
                          <div className="font-medium">{it.name}</div>
                          <div className="text-xs text-gray-500">
                            {(it.city || "").trim()}
                            {it.parent_name ? ` • ${it.parent_name}` : ""}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {allGroups.length === 0 && (
                  <div className="text-sm text-gray-600">
                    No direct matches. Press Enter to search results for “{q}”.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}