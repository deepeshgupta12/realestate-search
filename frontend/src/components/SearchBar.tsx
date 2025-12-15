"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, buildUrl } from "@/lib/api";
import type { SuggestResponse, ZeroStateResponse, ResolveResponse, EntityOut } from "@/lib/types";

type Props = {
  placeholder?: string;
  cityId?: string | null;
  contextUrl?: string | null;
};

function subtitle(e: EntityOut) {
  return [e.parent_name, e.city].filter(Boolean).join(" • ");
}

export default function SearchBar({ placeholder = "Search localities, projects, builders…", cityId, contextUrl }: Props) {
  const router = useRouter();

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [zero, setZero] = useState<ZeroStateResponse | null>(null);
  const [suggest, setSuggest] = useState<SuggestResponse | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const trimmed = q.trim();

  const sections = useMemo(() => {
    const s = suggest?.groups;
    if (!s) return null;
    return [
      { title: "Locations", key: "locations" as const, items: s.locations || [] },
      { title: "Projects", key: "projects" as const, items: s.projects || [] },
      { title: "Builders", key: "builders" as const, items: s.builders || [] },
      { title: "Property Rates", key: "rate_pages" as const, items: s.rate_pages || [] },
      { title: "Properties", key: "property_pdps" as const, items: s.property_pdps || [] },
    ];
  }, [suggest]);

  useEffect(() => {
    setOpen(true);

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const run = async () => {
      setLoading(true);
      try {
        if (!trimmed) {
          const z = await apiGet<ZeroStateResponse>(
            buildUrl("/search/zero-state", {
              limit: 8,
              city_id: cityId || undefined,
              context_url: contextUrl || undefined,
            }),
            { signal: ac.signal }
          );
          setZero(z);
          setSuggest(null);
        } else {
          const s = await apiGet<SuggestResponse>(
            buildUrl("/search/suggest", {
              q: trimmed,
              limit: 10,
              city_id: cityId || undefined,
              context_url: contextUrl || undefined,
            }),
            { signal: ac.signal }
          );
          setSuggest(s);
          setZero(null);
        }
      } catch {
        // swallow fetch aborts / network errors for local dev
      } finally {
        setLoading(false);
      }
    };

    const t = setTimeout(run, trimmed ? 120 : 0);
    return () => clearTimeout(t);
  }, [trimmed, cityId, contextUrl]);

  const onPick = (e: EntityOut, rank: number) => {
    // Route through /go (your existing flow logs click there)
    const sp = new URLSearchParams();
    sp.set("url", e.canonical_url);
    sp.set("entity_id", e.id);
    sp.set("entity_type", e.entity_type);
    sp.set("rank", String(rank));
    if (cityId) sp.set("city_id", cityId);
    if (contextUrl) sp.set("context_url", contextUrl);
    router.push(`/go?${sp.toString()}`);
    setOpen(false);
  };

  const onSubmit = async () => {
    const raw = trimmed;
    if (!raw) return;

    setLoading(true);
    try {
      const res = await apiGet<ResolveResponse>(
        buildUrl("/search/resolve", {
          q: raw,
          city_id: cityId || undefined,
          context_url: contextUrl || undefined,
        })
      );

      // Prefer backend-provided URL when available
      if (res.action === "redirect" && res.url) {
        router.push(`/go?${new URLSearchParams({ url: res.url }).toString()}`);
        return;
      }

      if (res.action === "disambiguate") {
        const sp = new URLSearchParams();
        sp.set("q", raw);
        if (cityId) sp.set("city_id", cityId);
        if (contextUrl) sp.set("context_url", contextUrl);
        router.push(`/disambiguate?${sp.toString()}`);
        return;
      }

      // serp fallback
      if (res.url) {
        router.push(res.url);
      } else {
        const sp = new URLSearchParams();
        sp.set("q", raw);
        if (cityId) sp.set("city_id", cityId);
        router.push(`/search?${sp.toString()}`);
      }
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded border px-3 py-2">
        <input
          className="w-full outline-none bg-transparent"
          value={q}
          placeholder={placeholder}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit();
            if (e.key === "Escape") setOpen(false);
          }}
        />
        <button
          className="text-sm rounded border px-3 py-1"
          onClick={onSubmit}
          disabled={loading || !trimmed}
        >
          Search
        </button>
      </div>

      {open ? (
        <div className="absolute z-50 mt-2 w-full rounded border bg-white shadow">
          <div className="px-3 py-2 text-xs opacity-70 flex items-center justify-between">
            <span>{loading ? "Loading…" : trimmed ? "Suggestions" : "Trending"}</span>
          </div>

          {/* Zero state */}
          {!trimmed && zero ? (
            <div className="divide-y">
              {zero.trending_searches?.length ? (
                <div className="p-2">
                  <div className="px-2 py-1 text-xs font-semibold opacity-70">Trending</div>
                  <div className="rounded border divide-y">
                    {zero.trending_searches.map((e, idx) => (
                      <button
                        key={e.id}
                        className="w-full text-left px-3 py-2 hover:bg-black/5"
                        onClick={() => onPick(e, idx + 1)}
                      >
                        <div className="text-sm font-medium">{e.name}</div>
                        <div className="text-xs opacity-70">{subtitle(e)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-4 text-sm opacity-70">No trending items.</div>
              )}
            </div>
          ) : null}

          {/* Suggest */}
          {trimmed && suggest && sections ? (
            <div className="divide-y">
              {sections.map((sec) =>
                sec.items.length ? (
                  <div key={sec.key} className="p-2">
                    <div className="px-2 py-1 text-xs font-semibold opacity-70">{sec.title}</div>
                    <div className="rounded border divide-y">
                      {sec.items.map((e, idx) => (
                        <button
                          key={e.id}
                          className="w-full text-left px-3 py-2 hover:bg-black/5"
                          onClick={() => onPick(e, idx + 1)}
                        >
                          <div className="text-sm font-medium">{e.name}</div>
                          <div className="text-xs opacity-70">{subtitle(e)}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null
              )}

              <div className="p-2">
                <button
                  className="w-full text-left px-3 py-2 hover:bg-black/5 text-sm"
                  onClick={onSubmit}
                >
                  See all results for “{trimmed}”
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}