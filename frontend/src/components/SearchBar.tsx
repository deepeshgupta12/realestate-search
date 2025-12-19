"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";

type EntityType =
  | "city"
  | "micromarket"
  | "locality"
  | "locality_overview"
  | "project"
  | "builder"
  | "rate_page"
  | "property_pdp"
  | "listing_page";

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
  fallbacks?: {
    relaxed_used?: boolean;
    trending?: EntityOut[];
    reason?: string | null;
  } | null;
};

type ZeroStateRecent = {
  q: string;
  city_id?: string | null;
  context_url?: string | null;
  timestamp?: string | null;
};

type ZeroStateResponse = {
  city_id: string | null;
  recent_searches: ZeroStateRecent[];
  trending_searches: EntityOut[];
  trending_localities: EntityOut[];
  popular_entities: EntityOut[];
};

type Props = {
  className?: string;
  /** pass current page path ("/", "/pune/baner", etc.). If not provided, we use pathname. */
  contextUrl?: string;
  /** optional city scope (if you want to hard-lock city from parent page) */
  defaultCityId?: string | null;
};

function enc(v: string): string {
  return encodeURIComponent(v);
}

export default function SearchBar({ className, contextUrl, defaultCityId = null }: Props) {
  const router = useRouter();
  const pathname = usePathname() || "/";

  // If contextUrl isn't explicitly passed (or is just "/"), use the actual pathname.
  const resolvedContextUrl = contextUrl && contextUrl !== "/" ? contextUrl : pathname;

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loadingSuggest, setLoadingSuggest] = useState(false);

  const [cityId, setCityId] = useState<string | null>(defaultCityId);

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
      `&context_url=${enc(resolvedContextUrl || "/")}`;

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
    const target = args.url?.startsWith("/") ? args.url : `/${args.url || ""}`;
    const fromQ = args.from_q ?? q.trim();

    const url =
      `/go?url=${enc(target)}` +
      (fromQ ? `&from_q=${enc(fromQ)}` : "") +
      (args.entity_id ? `&entity_id=${enc(args.entity_id)}` : "") +
      (args.entity_type ? `&entity_type=${enc(args.entity_type)}` : "") +
      (typeof args.rank === "number" ? `&rank=${enc(String(args.rank))}` : "") +
      (args.city_id ? `&city_id=${enc(args.city_id)}` : cityId ? `&city_id=${enc(cityId)}` : "") +
      `&context_url=${enc(resolvedContextUrl || "/")}`;

    setOpen(false);
    router.push(url);
  }

  async function loadZeroState() {
    try {
      const path =
        `/search/zero-state?limit=8` +
        (cityId ? `&city_id=${enc(cityId)}` : "") +
        `&context_url=${enc(resolvedContextUrl || "/")}`;

      const res = await apiGet<ZeroStateResponse>(path);
      setZero(res);
    } catch {
      // zero state is optional UX
    }
  }

  async function loadSuggest(query: string) {
    const qq = query.trim();
    if (!qq) {
      setSuggest(null);
      return;
    }
    setLoadingSuggest(true);
    try {
      const path =
        `/search/suggest?q=${enc(qq)}&limit=10` +
        (cityId ? `&city_id=${enc(cityId)}` : "") +
        `&context_url=${enc(resolvedContextUrl || "/")}`;

      const res = await apiGet<SuggestResponse>(path);
      setSuggest(res);
    } finally {
      setLoadingSuggest(false);
    }
  }

  async function clearRecentSearches() {
    try {
      await apiPost("/events/recent/clear", { city_id: cityId });
      await loadZeroState();
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadZeroState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId, resolvedContextUrl]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    debounceRef.current = window.setTimeout(() => {
      loadSuggest(q);
    }, 120);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open, cityId, resolvedContextUrl]);

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
                {(zero?.recent_searches || []).length > 0 && (
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-gray-600">Recent searches</div>
                      <button
                        type="button"
                        onClick={clearRecentSearches}
                        className="text-xs font-semibold text-gray-500 hover:text-gray-700"
                      >
                        Clear
                      </button>
                    </div>

                    <div className="mt-2 space-y-1">
                      {(zero?.recent_searches || []).map((it, idx) => (
                        <button
                          key={`recent_${it.q}_${idx}`}
                          className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50"
                          onClick={() => goToGoQuery(it.q)}
                          type="button"
                        >
                          <div className="font-medium">{it.q}</div>
                          <div className="text-xs text-gray-500">
                            {(it.city_id || "").trim()}
                            {it.context_url ? ` • ${it.context_url}` : ""}
                          </div>
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

                {(zero?.popular_entities || []).length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-600">Popular</div>
                    <div className="mt-2 space-y-1">
                      {(zero?.popular_entities || []).slice(0, 6).map((it, idx) => (
                        <button
                          key={`pop_${it.id}_${idx}`}
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
                )}
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

                {allGroups.map((grp) => (
                  <div key={grp.key} className="mb-3">
                    <div className="text-xs font-semibold text-gray-600">{grp.title}</div>
                    <div className="mt-1 space-y-1">
                      {grp.items.map((it, idx) => (
                        <button
                          key={`${grp.key}_${it.id}_${idx}`}
                          className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50"
                          onClick={() =>
                            goToGoClick({
                              url: it.canonical_url,
                              from_q: q,
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