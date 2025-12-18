"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";

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
  fallbacks: {
    relaxed_used: boolean;
    trending: EntityOut[];
    reason: string | null;
  };
};

type ZeroStateResponse = {
  city_id: string | null;
  recent_searches: {
    q: string;
    city_id?: string | null;
    context_url?: string | null;
    timestamp?: string | null;
  }[];
  trending_searches: EntityOut[];
  trending_localities: EntityOut[];
  popular_entities: EntityOut[];
};

type Props = {
  className?: string;
  /** Optional override. If not passed, component uses current pathname. */
  contextUrl?: string;
  /** Optional hard lock. If not passed, component infers from contextUrl when possible. */
  defaultCityId?: string | null;
};

function enc(v: string): string {
  return encodeURIComponent(v);
}

/** V0 mapping (seed cities). Later this moves to config/DB. */
const CITY_SLUG_TO_ID: Record<string, string> = {
  pune: "city_pune",
  noida: "city_noida",
};

function inferCityIdFromContextUrl(contextUrl: string): string | null {
  if (!contextUrl) return null;

  let path = contextUrl.trim();

  try {
    if (path.startsWith("http://") || path.startsWith("https://")) {
      const u = new URL(path);
      path = u.pathname || "/";
    }
  } catch {
    // ignore
  }

  const seg = path.split("?")[0].split("#")[0].split("/").filter(Boolean);
  if (seg.length === 0) return null;

  let citySlug: string | null = null;

  if (seg[0] === "property-rates" && seg[1]) citySlug = seg[1];
  else if (seg[0] === "projects" && seg[1]) citySlug = seg[1];
  else if (!["search", "disambiguate", "go", "builders"].includes(seg[0])) citySlug = seg[0];

  if (!citySlug) return null;

  return CITY_SLUG_TO_ID[citySlug.toLowerCase()] || null;
}

export default function SearchBar({ className, contextUrl, defaultCityId = null }: Props) {
  const router = useRouter();
  const pathname = usePathname() || "/";

  const effectiveContextUrl = useMemo(() => {
    // If caller passed a meaningful contextUrl, use it. Otherwise, use pathname.
    if (contextUrl && contextUrl.trim() && contextUrl.trim() !== "/") return contextUrl.trim();
    return pathname;
  }, [contextUrl, pathname]);

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loadingSuggest, setLoadingSuggest] = useState(false);

  const [cityId, setCityId] = useState<string | null>(defaultCityId);

  const [zero, setZero] = useState<ZeroStateResponse | null>(null);
  const [suggest, setSuggest] = useState<SuggestResponse | null>(null);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<number | null>(null);

  const hasQuery = q.trim().length > 0;

  // infer city if not hard-locked
  useEffect(() => {
    if (defaultCityId) return;
    if (cityId) return;

    const inferred = inferCityIdFromContextUrl(effectiveContextUrl);
    if (inferred) setCityId(inferred);
  }, [defaultCityId, cityId, effectiveContextUrl]);

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

  function goToGoQuery(rawQuery: string, overrideCityId?: string | null) {
    const qq = rawQuery.trim();
    if (!qq) return;

    const useCityId = overrideCityId === undefined ? cityId : overrideCityId;

    const url =
      `/go?q=${enc(qq)}` +
      (useCityId ? `&city_id=${enc(useCityId)}` : "") +
      `&context_url=${enc(effectiveContextUrl || "/")}`;

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
      (args.city_id ? `&city_id=${enc(args.city_id)}` : (cityId ? `&city_id=${enc(cityId)}` : "")) +
      `&context_url=${enc(effectiveContextUrl || "/")}`;

    setOpen(false);
    router.push(url);
  }

  async function loadZeroState() {
    try {
      const path =
        `/search/zero-state?limit=8` +
        (cityId ? `&city_id=${enc(cityId)}` : "") +
        `&context_url=${enc(effectiveContextUrl || "/")}`;
      const res = await apiGet<ZeroStateResponse>(path);
      setZero(res);
    } catch {
      // ignore
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
        `&context_url=${enc(effectiveContextUrl || "/")}`;
      const res = await apiGet<SuggestResponse>(path);
      setSuggest(res);
    } finally {
      setLoadingSuggest(false);
    }
  }

  useEffect(() => {
    loadZeroState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId, effectiveContextUrl]);

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
  }, [q, open, cityId, effectiveContextUrl]);

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
              <div className="p-3">
                {(zero?.recent_searches || []).length > 0 && (
                  <div className="mb-4">
                    <div className="text-xs font-semibold text-gray-600">Recent searches</div>
                    <div className="mt-2 space-y-1">
                      {(zero?.recent_searches || []).map((rs, idx) => (
                        <button
                          key={`recent_${rs.q}_${rs.timestamp || ""}_${idx}`}
                          className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50"
                          onClick={() => goToGoQuery(rs.q, rs.city_id ?? null)}
                          type="button"
                        >
                          <div className="font-medium">{rs.q}</div>
                          {rs.timestamp ? (
                            <div className="text-xs text-gray-500">{new Date(rs.timestamp).toLocaleString()}</div>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

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