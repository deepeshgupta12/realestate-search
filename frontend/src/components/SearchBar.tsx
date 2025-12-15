"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import type { EntityOut, SuggestResponse, ZeroStateResponse, ResolveResponse } from "@/lib/types";

type Props = {
  placeholder?: string;
  cityId?: string | null;
  contextUrl?: string | null;
};

type FlatItem =
  | ({ kind: "entity"; group: keyof SuggestResponse["groups"] } & EntityOut)
  | { kind: "query"; group: "queries"; text: string }
  | { kind: "trending"; group: "trending"; text: string };

function normalizeInput(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function apiAbsUrl(path: string) {
  const base = (process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000").replace(/\/$/, "");
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (!path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}

export default function SearchBar({
  placeholder = "Search projects, localities, builders…",
  cityId,
  contextUrl,
}: Props) {
  const router = useRouter();

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [zero, setZero] = useState<ZeroStateResponse | null>(null);
  const [suggest, setSuggest] = useState<SuggestResponse | null>(null);

  const [highlight, setHighlight] = useState(0);
  const [currentQid, setCurrentQid] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const flatItems: FlatItem[] = useMemo(() => {
    const items: FlatItem[] = [];
    const nq = normalizeInput(q);

    if (!nq) {
      const z = zero;
      if (!z) return items;

      if (z.recent_searches?.length) {
        for (const t of z.recent_searches) {
          items.push({ kind: "query", group: "queries", text: t });
        }
      }

      if (z.trending_searches?.length) {
        for (const e of z.trending_searches) {
          items.push({ kind: "entity", group: "locations", ...e });
        }
      }
      return items;
    }

    const s = suggest;
    if (!s) return items;

    const groups = s.groups;
    (Object.keys(groups) as (keyof SuggestResponse["groups"])[]).forEach((g) => {
      for (const e of groups[g]) {
        items.push({ kind: "entity", group: g, ...e });
      }
    });

    return items;
  }, [q, zero, suggest]);

  async function logSearch(qid: string, raw: string) {
    const payload = {
      query_id: qid,
      raw_query: raw,
      normalized_query: normalizeInput(raw).toLowerCase(),
      city_id: cityId ?? null,
      context_url: contextUrl ?? "/",
      timestamp: new Date().toISOString(),
    };

    const res = await fetch(apiAbsUrl("/api/v1/events/search"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.warn("events/search failed:", res.status);
    }
  }

  function goToUrl(url: string, opts?: { qid?: string; entity?: EntityOut; rank?: number }) {
    const qid = opts?.qid ?? currentQid ?? undefined;

    const params = new URLSearchParams();
    params.set("url", url);

    if (qid) params.set("qid", qid);
    if (opts?.entity?.id) params.set("entity_id", opts.entity.id);
    if (opts?.entity?.entity_type) params.set("entity_type", String(opts.entity.entity_type));
    if (typeof opts?.rank === "number") params.set("rank", String(opts.rank));

    if (cityId) params.set("city_id", cityId);
    if (contextUrl) params.set("context_url", contextUrl);

    router.push(`/go?${params.toString()}`);
  }

  function goToSerpUrl(url: string, qid?: string) {
    const joiner = url.includes("?") ? "&" : "?";
    router.push(`${url}${qid ? `${joiner}qid=${encodeURIComponent(qid)}` : ""}`);
  }

  async function submitQuery(raw: string) {
    const clean = normalizeInput(raw);
    if (!clean) return;

    const qid = crypto.randomUUID();
    setCurrentQid(qid);

    await logSearch(qid, clean);

    try {
      const rr = await apiGet<ResolveResponse>("/api/v1/search/resolve", {
        q: clean,
        city_id: cityId ?? undefined,
      });

      if (rr.action === "redirect" && rr.url) {
        goToUrl(rr.url, { qid, entity: rr.match ?? undefined, rank: 1 });
        return;
      }

      if (rr.action === "disambiguate") {
        const url =
          `/disambiguate?q=${encodeURIComponent(clean)}` +
          (cityId ? `&city_id=${encodeURIComponent(cityId)}` : "") +
          `&qid=${encodeURIComponent(qid)}` +
          (contextUrl ? `&context_url=${encodeURIComponent(contextUrl)}` : "");
        router.push(url);
        return;
      }

      if (rr.url) {
        goToSerpUrl(rr.url, qid);
        return;
      }

      goToSerpUrl(
        `/search?q=${encodeURIComponent(clean)}${cityId ? `&city_id=${encodeURIComponent(cityId)}` : ""}`,
        qid
      );
    } catch (e) {
      console.warn("resolve failed, falling back to SERP", e);
      goToSerpUrl(
        `/search?q=${encodeURIComponent(clean)}${cityId ? `&city_id=${encodeURIComponent(cityId)}` : ""}`,
        qid
      );
    }
  }

  useEffect(() => {
    if (!open) return;
    const clean = normalizeInput(q);
    if (clean) return;

    let cancelled = false;
    setLoading(true);

    apiGet<ZeroStateResponse>("/api/v1/search/zero-state", {
      city_id: cityId ?? undefined,
      context_url: contextUrl ?? undefined,
      limit: 8,
    })
      .then((z) => {
        if (!cancelled) setZero(z);
      })
      .catch((e) => console.warn("zero-state failed", e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, q, cityId, contextUrl]);

  useEffect(() => {
    const clean = normalizeInput(q);
    if (!open) return;

    setHighlight(0);

    if (!clean) {
      setSuggest(null);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);

    apiGet<SuggestResponse>("/api/v1/search/suggest", {
      q: clean,
      city_id: cityId ?? undefined,
      context_url: contextUrl ?? undefined,
      limit: 10,
    })
      .then((s) => {
        if (!ac.signal.aborted) setSuggest(s);
      })
      .catch((e) => {
        if (!ac.signal.aborted) console.warn("suggest failed", e);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });

    return () => ac.abort();
  }, [q, open, cityId, contextUrl]);

  function selectItem(item: FlatItem, rank: number) {
    if (item.kind === "entity") {
      const qid = currentQid ?? crypto.randomUUID();
      setCurrentQid(qid);

      goToUrl(item.canonical_url, {
        qid,
        entity: {
          id: item.id,
          entity_type: item.entity_type,
          name: item.name,
          city: item.city,
          city_id: item.city_id,
          parent_name: item.parent_name,
          canonical_url: item.canonical_url,
          score: item.score ?? null,
          popularity_score: item.popularity_score ?? null,
        },
        rank,
      });

      setOpen(false);
      return;
    }

    const text = item.kind === "query" || item.kind === "trending" ? item.text : "";
    setQ(text);
    setOpen(false);
    submitQuery(text);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(flatItems.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flatItems[highlight];
      if (item) selectItem(item, highlight + 1);
      else submitQuery(q);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div
      className="searchWrap"
      onBlur={(e) => {
        const next = e.relatedTarget as HTMLElement | null;
        if (next && e.currentTarget.contains(next)) return;
        setOpen(false);
      }}
    >
      <form
        className="searchForm"
        onSubmit={(e) => {
          e.preventDefault();
          submitQuery(q);
        }}
      >
        <input
          ref={inputRef}
          className="searchInput"
          value={q}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Search"
        />
        <button className="searchBtn" type="submit">
          Search
        </button>
      </form>

      {open && (
        <div className="dropdown" role="listbox" aria-label="Search suggestions">
          {loading && <div className="dropdownRow muted">Loading…</div>}

          {!loading && normalizeInput(q) && suggest?.did_you_mean && (
            <button
              type="button"
              className="dropdownRow"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => submitQuery(suggest.did_you_mean || "")}
            >
              <span className="muted">Did you mean</span>{" "}
              <span style={{ fontWeight: 600 }}>{suggest.did_you_mean}</span>
            </button>
          )}

          {!loading && flatItems.length === 0 && <div className="dropdownRow muted">No suggestions</div>}

          {!loading &&
            flatItems.map((item, idx) => {
              const active = idx === highlight;

              if (item.kind === "entity") {
                return (
                  <button
                    key={`${item.kind}-${item.id}-${idx}`}
                    type="button"
                    className={`dropdownRow ${active ? "active" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectItem(item, idx + 1)}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{item.name}</div>
                        <div className="meta">
                          {item.entity_type}
                          {item.city ? ` • ${item.city}` : ""}
                          {item.parent_name ? ` • ${item.parent_name}` : ""}
                        </div>
                      </div>
                      {item.city && <span className="pill">{item.city}</span>}
                    </div>
                  </button>
                );
              }

              const text = item.text;
              return (
                <button
                  key={`${item.kind}-${text}-${idx}`}
                  type="button"
                  className={`dropdownRow ${active ? "active" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectItem(item, idx + 1)}
                >
                  <span>{text}</span>
                </button>
              );
            })}

          {!loading && normalizeInput(q) && (
            <button
              type="button"
              className="dropdownRow"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const clean = normalizeInput(q);
                const url = `/search?q=${encodeURIComponent(clean)}${cityId ? `&city_id=${encodeURIComponent(cityId)}` : ""}`;
                router.push(url);
                setOpen(false);
              }}
            >
              See all results for <strong>“{normalizeInput(q)}”</strong>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
