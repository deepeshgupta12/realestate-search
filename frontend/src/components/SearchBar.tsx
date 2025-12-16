"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import type { EntityOut, SuggestResponse, ZeroStateResponse, ResolveResponse, EventOk } from "@/lib/types";

type Props = {
  contextUrl?: string;
};

function mkQid(): string {
  // Works in modern browsers; fallback for older environments
  try {
    // @ts-expect-error crypto may not be typed in some setups
    return crypto.randomUUID();
  } catch {
    return `qid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function enc(v: string): string {
  return encodeURIComponent(v);
}

function goHref(args: {
  url: string;
  qid: string;
  entityId?: string;
  entityType?: string;
  rank?: number;
  cityId?: string | null;
  contextUrl?: string | null;
}): string {
  const qp: string[] = [];
  qp.push(`url=${enc(args.url)}`);
  qp.push(`qid=${enc(args.qid)}`);
  if (args.entityId) qp.push(`entity_id=${enc(args.entityId)}`);
  if (args.entityType) qp.push(`entity_type=${enc(args.entityType)}`);
  if (typeof args.rank === "number") qp.push(`rank=${args.rank}`);
  if (args.cityId) qp.push(`city_id=${enc(args.cityId)}`);
  if (args.contextUrl) qp.push(`context_url=${enc(args.contextUrl)}`);
  return `/go?${qp.join("&")}`;
}

export default function SearchBar({ contextUrl = "/" }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [q, setQ] = useState("");
  const [cityId, setCityId] = useState<string>("");

  const [zero, setZero] = useState<ZeroStateResponse | null>(null);
  const [suggest, setSuggest] = useState<SuggestResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [showDropdown, setShowDropdown] = useState(false);

  const [disambOpen, setDisambOpen] = useState(false);
  const [disambQid, setDisambQid] = useState<string | null>(null);
  const [disambQuery, setDisambQuery] = useState<string>("");
  const [disambCandidates, setDisambCandidates] = useState<EntityOut[]>([]);

  const normalizedCityId = cityId.trim() ? cityId.trim() : null;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setErr(null);
        const data = await apiGet<ZeroStateResponse>("/search/zero-state", {
          city_id: normalizedCityId,
          context_url: contextUrl,
          limit: 8,
        });
        if (!cancelled) setZero(data);
      } catch (e: any) {
        if (!cancelled) setErr(String(e?.message || e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [normalizedCityId, contextUrl]);

  useEffect(() => {
    const qq = q.trim();
    if (!qq) {
      setSuggest(null);
      return;
    }

    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        setErr(null);
        const data = await apiGet<SuggestResponse>("/search/suggest", {
          q: qq,
          city_id: normalizedCityId,
          context_url: contextUrl,
          limit: 10,
        });
        if (!cancelled) {
          setSuggest(data);
          setShowDropdown(true);
        }
      } catch (e: any) {
        if (!cancelled) setErr(String(e?.message || e));
      }
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, normalizedCityId, contextUrl]);

  const groups = suggest?.groups;
  const hasAnySuggestions = useMemo(() => {
    if (!groups) return false;
    return (
      groups.locations.length +
        groups.projects.length +
        groups.builders.length +
        groups.rate_pages.length +
        groups.property_pdps.length >
      0
    );
  }, [groups]);

  async function logSearch(qid: string, raw: string, normalized: string) {
    try {
      await apiPost<EventOk>("/events/search", {
        query_id: qid,
        raw_query: raw,
        normalized_query: normalized,
        city_id: normalizedCityId,
        context_url: contextUrl,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // non-blocking
    }
  }

  function navigateViaGo(item: EntityOut, qid: string, rank: number) {
    const href = goHref({
      url: item.canonical_url,
      qid,
      entityId: item.id,
      entityType: item.entity_type,
      rank,
      cityId: normalizedCityId,
      contextUrl,
    });
    router.push(href);
  }

  async function onSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const raw = q.trim();
    if (!raw) return;

    setLoading(true);
    setErr(null);

    const qid = mkQid();

    try {
      const res = await apiGet<ResolveResponse>("/search/resolve", {
        q: raw,
        city_id: normalizedCityId,
        context_url: contextUrl,
      });

      await logSearch(qid, raw, res.normalized_query);

      if (res.action === "redirect") {
        if (res.match) {
          navigateViaGo(res.match, qid, 1);
        } else {
          router.push(goHref({ url: res.url, qid, cityId: normalizedCityId, contextUrl }));
        }
        return;
      }

      if (res.action === "serp") {
        router.push(res.url);
        return;
      }

      // disambiguate
      setDisambQid(qid);
      setDisambQuery(raw);
      setDisambCandidates(res.candidates || []);
      setDisambOpen(true);
      setShowDropdown(false);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  function renderEntityRow(item: EntityOut, idx: number) {
    return (
      <button
        key={`${item.id}_${idx}`}
        type="button"
        className="w-full text-left px-3 py-2 hover:bg-white/5 rounded-md"
        onClick={() => {
          const qid = disambQid || mkQid();
          // treat a disambiguation selection as a click on the chosen entity
          navigateViaGo(item, qid, idx + 1);
          setDisambOpen(false);
        }}
      >
        <div className="text-sm font-semibold">{item.name}</div>
        <div className="text-xs opacity-70">
          {item.entity_type} · {item.city || "-"}{item.parent_name ? ` · ${item.parent_name}` : ""}
        </div>
      </button>
    );
  }

  return (
    <div className="w-full">
      <form onSubmit={onSubmit} className="flex gap-2 items-center">
        <select
          className="bg-white/5 border border-white/10 rounded-md px-2 py-2 text-sm"
          value={cityId}
          onChange={(e) => setCityId(e.target.value)}
        >
          <option value="">All Cities</option>
          <option value="city_pune">Pune</option>
          <option value="city_noida">Noida</option>
        </select>

        <div className="flex-1 relative">
          <input
            ref={inputRef}
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
            placeholder="Search city, locality, project, builder…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setShowDropdown(true)}
          />

          {showDropdown && (q.trim() ? (suggest !== null) : (zero !== null)) && (
            <div className="absolute z-50 mt-2 w-full bg-black/80 border border-white/10 rounded-lg p-2 backdrop-blur">
              {!q.trim() && zero && (
                <div className="space-y-3">
                  <div>
                    <div className="text-xs font-semibold opacity-70 mb-2">Trending</div>
                    <div className="flex flex-wrap gap-2">
                      {(zero.trending_searches || []).map((x, idx) => (
                        <button
                          key={`${x.id}_${idx}`}
                          type="button"
                          className="px-2 py-1 text-xs bg-white/5 border border-white/10 rounded-md hover:bg-white/10"
                          onClick={() => {
                            setQ(x.name);
                            setShowDropdown(false);
                            inputRef.current?.focus();
                          }}
                        >
                          {x.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold opacity-70 mb-2">Popular localities</div>
                    <div className="flex flex-wrap gap-2">
                      {(zero.trending_localities || []).map((x, idx) => (
                        <button
                          key={`${x.id}_${idx}`}
                          type="button"
                          className="px-2 py-1 text-xs bg-white/5 border border-white/10 rounded-md hover:bg-white/10"
                          onClick={() => {
                            setQ(x.name);
                            setShowDropdown(false);
                            inputRef.current?.focus();
                          }}
                        >
                          {x.name}{x.city ? ` · ${x.city}` : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {q.trim() && suggest && (
                <div className="space-y-3">
                  {suggest.did_you_mean && (
                    <div className="text-xs opacity-80 px-2">
                      Did you mean{" "}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => {
                          setQ(suggest.did_you_mean || "");
                          inputRef.current?.focus();
                        }}
                      >
                        {suggest.did_you_mean}
                      </button>
                      ?
                    </div>
                  )}

                  {groups?.locations?.length ? (
                    <div>
                      <div className="text-xs font-semibold opacity-70 mb-1 px-2">Locations</div>
                      <div className="space-y-1">
                        {groups.locations.map((x, idx) => (
                          <button
                            key={`${x.id}_${idx}`}
                            type="button"
                            className="w-full text-left px-2 py-2 hover:bg-white/5 rounded-md"
                            onClick={() => {
                              const qid = mkQid();
                              // on direct suggestion click, treat as click-through immediately
                              navigateViaGo(x, qid, idx + 1);
                              setShowDropdown(false);
                            }}
                          >
                            <div className="text-sm font-semibold">{x.name}</div>
                            <div className="text-xs opacity-70">
                              {x.entity_type} · {x.city || "-"}{x.parent_name ? ` · ${x.parent_name}` : ""}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {groups?.rate_pages?.length ? (
                    <div>
                      <div className="text-xs font-semibold opacity-70 mb-1 px-2">Property Rates</div>
                      <div className="space-y-1">
                        {groups.rate_pages.map((x, idx) => (
                          <button
                            key={`${x.id}_${idx}`}
                            type="button"
                            className="w-full text-left px-2 py-2 hover:bg-white/5 rounded-md"
                            onClick={() => {
                              const qid = mkQid();
                              navigateViaGo(x, qid, idx + 1);
                              setShowDropdown(false);
                            }}
                          >
                            <div className="text-sm font-semibold">{x.name}</div>
                            <div className="text-xs opacity-70">
                              {x.entity_type} · {x.city || "-"}{x.parent_name ? ` · ${x.parent_name}` : ""}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {groups?.property_pdps?.length ? (
                    <div>
                      <div className="text-xs font-semibold opacity-70 mb-1 px-2">Properties</div>
                      <div className="space-y-1">
                        {groups.property_pdps.map((x, idx) => (
                          <button
                            key={`${x.id}_${idx}`}
                            type="button"
                            className="w-full text-left px-2 py-2 hover:bg-white/5 rounded-md"
                            onClick={() => {
                              const qid = mkQid();
                              navigateViaGo(x, qid, idx + 1);
                              setShowDropdown(false);
                            }}
                          >
                            <div className="text-sm font-semibold">{x.name}</div>
                            <div className="text-xs opacity-70">
                              {x.entity_type} · {x.city || "-"}{x.parent_name ? ` · ${x.parent_name}` : ""}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="pt-2 border-t border-white/10">
                    <button
                      type="button"
                      className="w-full text-left px-2 py-2 text-sm hover:bg-white/5 rounded-md"
                      onClick={() => {
                        setShowDropdown(false);
                        router.push(`/search?q=${enc(q.trim())}${normalizedCityId ? `&city_id=${enc(normalizedCityId)}` : ""}`);
                      }}
                    >
                      See all results for "{q.trim()}"
                    </button>
                  </div>

                  {!hasAnySuggestions && (
                    <div className="text-xs opacity-70 px-2">
                      No matches. Press Enter to search.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="bg-white/10 border border-white/15 rounded-md px-4 py-2 text-sm hover:bg-white/15 disabled:opacity-60"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {err && <div className="mt-2 text-xs opacity-80">Error: {err}</div>}

      {disambOpen && (
        <div className="mt-3 border border-white/10 rounded-lg bg-white/5 p-3">
          <div className="text-sm font-semibold mb-2">
            Multiple matches for "{disambQuery}". Choose one:
          </div>
          <div className="space-y-1">
            {(disambCandidates || []).map((x, idx) => renderEntityRow(x, idx))}
          </div>

          <div className="pt-2 mt-2 border-t border-white/10">
            <button
              type="button"
              className="text-sm underline"
              onClick={() => {
                setDisambOpen(false);
                router.push(`/search?q=${enc(disambQuery)}${normalizedCityId ? `&city_id=${enc(normalizedCityId)}` : ""}`);
              }}
            >
              Or see all results
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
