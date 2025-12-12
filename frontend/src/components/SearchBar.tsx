"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { resolve, suggest, trending } from "@/lib/api";
import type { SuggestItem, SuggestResponse } from "@/lib/types";

type Props = {
  initialQuery?: string;
  initialCityId?: string;
};

const CITY_OPTIONS = [
  { label: "All Cities", value: "" },
  { label: "Pune", value: "city_pune" },
  { label: "Noida", value: "city_noida" },
];

type RecentItem = { q: string; cityId: string; ts: number };

const LS_KEY = "re_search_recent_v1";

function loadRecents(): RecentItem[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as RecentItem[];
  } catch {
    return [];
  }
}

function saveRecent(item: RecentItem) {
  const recents = loadRecents();
  const next = [
    item,
    ...recents.filter(
      (r) => !(r.q.toLowerCase() === item.q.toLowerCase() && r.cityId === item.cityId)
    ),
  ].slice(0, 8);
  localStorage.setItem(LS_KEY, JSON.stringify(next));
}

function groupKey(entityType: string): "locations" | "projects" | "builders" | "rate_pages" | "property_pdps" | "other" {
  if (["city", "micromarket", "locality", "listing_page", "locality_overview"].includes(entityType))
    return "locations";
  if (entityType === "project") return "projects";
  if (entityType === "builder") return "builders";
  if (entityType === "rate_page") return "rate_pages";
  if (entityType === "property_pdp") return "property_pdps";
  return "other";
}

function groupLabel(k: string): string {
  if (k === "locations") return "Locations";
  if (k === "projects") return "Projects";
  if (k === "builders") return "Builders";
  if (k === "rate_pages") return "Property Rates";
  if (k === "property_pdps") return "Properties";
  return "Other";
}

function badge(entityType: string): string {
  if (["city", "micromarket", "locality", "listing_page", "locality_overview"].includes(entityType)) return "LOC";
  if (entityType === "project") return "PRJ";
  if (entityType === "builder") return "DEV";
  if (entityType === "rate_page") return "RATE";
  if (entityType === "property_pdp") return "PROP";
  return "ITEM";
}

function highlight(text: string, q: string): React.ReactNode {
  const query = q.trim();
  if (!query) return text;

  const t = text;
  const lowerT = t.toLowerCase();
  const lowerQ = query.toLowerCase();

  const idx = lowerT.indexOf(lowerQ);
  if (idx < 0) return text;

  const before = t.slice(0, idx);
  const mid = t.slice(idx, idx + query.length);
  const after = t.slice(idx + query.length);

  return (
    <>
      {before}
      <span style={{ background: "rgba(138,180,255,0.22)", padding: "0 2px", borderRadius: 4 }}>
        {mid}
      </span>
      {after}
    </>
  );
}

export default function SearchBar({ initialQuery, initialCityId }: Props) {
  const router = useRouter();

  const [q, setQ] = useState(initialQuery || "");
  const [cityId, setCityId] = useState(initialCityId || "");

  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<SuggestResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [error, setError] = useState<string | null>(null);

  const [trend, setTrend] = useState<any[]>([]);
  const [recents, setRecents] = useState<RecentItem[]>([]);

  const lastReq = useRef(0);

  // Portal anchor
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null);

  const flatItems = useMemo(() => {
    if (!resp) return [];
    return [
      ...resp.groups.locations,
      ...resp.groups.projects,
      ...resp.groups.builders,
      ...resp.groups.rate_pages,
      ...resp.groups.property_pdps,
    ];
  }, [resp]);

  const grouped = useMemo(() => {
    const g: Record<string, SuggestItem[]> = {
      locations: [],
      projects: [],
      builders: [],
      rate_pages: [],
      property_pdps: [],
      other: [],
    };
    for (const it of flatItems) g[groupKey(it.entity_type)].push(it);
    return g;
  }, [flatItems]);

  const hasAnySuggestions = useMemo(() => {
    return flatItems.length > 0 || Boolean(resp?.did_you_mean);
  }, [flatItems.length, resp?.did_you_mean]);

  const showNoResultsWhileTyping = useMemo(() => {
    return q.trim().length > 0 && !hasAnySuggestions;
  }, [q, hasAnySuggestions]);

  // Load recents once
  useEffect(() => {
    if (typeof window === "undefined") return;
    setRecents(loadRecents());
  }, []);

  // Compute portal position when open
  useEffect(() => {
    if (!open) return;

    const update = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setAnchor({
        left: rect.left,
        top: rect.bottom + 6,
        width: rect.width,
      });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      const inContainer = containerRef.current?.contains(t);
      const inDropdown = dropdownRef.current?.contains(t);
      if (!inContainer && !inDropdown) {
        setOpen(false);
        setActiveIdx(-1);
      }
    };

    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Fetch trending (city-scoped) when dropdown opens or city changes
  useEffect(() => {
    if (!open) return;
    trending(cityId || undefined, 10)
      .then((r) => setTrend(r.items || []))
      .catch(() => setTrend([]));
  }, [open, cityId]);

  // Debounced suggest
  useEffect(() => {
    const query = q.trim();
    if (query.length < 1) {
      setResp(null);
      setActiveIdx(-1);
      return;
    }

    const reqId = ++lastReq.current;
    setLoading(true);
    setError(null);

    const t = setTimeout(() => {
      suggest(query, cityId || undefined, 10)
        .then((r) => {
          if (reqId !== lastReq.current) return;
          setResp(r);
          setOpen(true);
          setActiveIdx(-1);
        })
        .catch((e) => {
          if (reqId !== lastReq.current) return;
          setError(e.message || "Suggest failed");
          setResp(null);
        })
        .finally(() => {
          if (reqId !== lastReq.current) return;
          setLoading(false);
        });
    }, 150);

    return () => clearTimeout(t);
  }, [q, cityId]);

  function recordRecent(queryText: string) {
    if (typeof window === "undefined") return;
    const queryTrim = queryText.trim();
    if (!queryTrim) return;
    saveRecent({ q: queryTrim, cityId: cityId || "", ts: Date.now() });
    setRecents(loadRecents());
  }

  function goToUrl(url: string, queryText: string) {
    recordRecent(queryText);
    setOpen(false);
    setActiveIdx(-1);
    router.push(`/go?url=${encodeURIComponent(url)}&q=${encodeURIComponent(queryText)}`);
  }

  async function submitRawQuery(query: string) {
    const queryTrim = query.trim();
    if (!queryTrim) return;

    setLoading(true);
    setError(null);

    try {
      const r = await resolve(queryTrim, cityId || undefined);
      recordRecent(queryTrim);

      if (r.action === "redirect") {
        router.push(`/go?url=${encodeURIComponent(r.url)}&q=${encodeURIComponent(queryTrim)}`);
        return;
      }

      const params = new URLSearchParams({ q: queryTrim });
      if (cityId) params.set("city_id", cityId);
      router.push(`/search?${params.toString()}`);
    } catch (e: any) {
      setError(e.message || "Resolve failed");
    } finally {
      setLoading(false);
      setOpen(false);
      setActiveIdx(-1);
    }
  }

  // Keyboard nav is flat across sections for simplicity
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "Enter") submitRawQuery(q);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((v) => Math.min(v + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((v) => Math.max(v - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = activeIdx >= 0 ? flatItems[activeIdx] : null;
      if (selected?.canonical_url) {
        goToUrl(selected.canonical_url, selected.name);
      } else {
        submitRawQuery(q);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    }
  }

  function renderItem(it: SuggestItem, idxFlat: number) {
    return (
      <div
        key={it.id}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (it.canonical_url ? goToUrl(it.canonical_url, it.name) : submitRawQuery(it.name))}
        style={{
          padding: "10px 12px",
          cursor: "pointer",
          background: idxFlat === activeIdx ? "rgba(138,180,255,0.14)" : "transparent",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
        }}
      >
        <div
          style={{
            minWidth: 44,
            textAlign: "center",
            fontSize: 11,
            fontWeight: 800,
            padding: "5px 6px",
            borderRadius: 8,
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.10)",
            lineHeight: "12px",
          }}
        >
          {badge(it.entity_type)}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 750 }}>{highlight(it.name, q)}</div>
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
            {it.entity_type}
            {it.city ? ` • ${it.city}` : ""}
            {it.parent_name ? ` • ${it.parent_name}` : ""}
          </div>
        </div>
      </div>
    );
  }

  const dropdownInner = (
    <div>
      {/* Empty query: show Recents + Trending */}
      {q.trim().length === 0 ? (
        <div>
          {recents.length > 0 ? (
            <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.10)" }}>
              <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>Recent searches</div>
              {recents.map((r) => (
                <div
                  key={`${r.q}-${r.cityId}-${r.ts}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => submitRawQuery(r.q)}
                  style={{ padding: "8px 6px", cursor: "pointer", borderRadius: 8 }}
                >
                  <div style={{ fontSize: 14, fontWeight: 650 }}>{r.q}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {r.cityId ? `City: ${r.cityId}` : "All Cities"}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div style={{ padding: "10px 12px" }}>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>Trending</div>
            {trend.length === 0 ? (
              <div style={{ fontSize: 14, opacity: 0.7 }}>No trending items</div>
            ) : (
              trend.slice(0, 10).map((t: any) => (
                <div
                  key={t.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => (t.canonical_url ? goToUrl(t.canonical_url, t.name) : submitRawQuery(t.name))}
                  style={{ padding: "8px 6px", cursor: "pointer", borderRadius: 8 }}
                >
                  <div style={{ fontSize: 14, fontWeight: 650 }}>{t.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {t.entity_type}
                    {t.city ? ` • ${t.city}` : ""}
                    {t.parent_name ? ` • ${t.parent_name}` : ""}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div>
          {/* Non-empty query */}
          {resp?.did_you_mean ? (
            <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.10)", fontSize: 14 }}>
              Did you mean{" "}
              <button
                onClick={() => submitRawQuery(resp.did_you_mean!)}
                style={{ border: "none", background: "transparent", color: "#8ab4ff", cursor: "pointer" }}
              >
                {resp.did_you_mean}
              </button>
              ?
            </div>
          ) : null}

          {flatItems.length > 0 ? (
            <div>
              {Object.entries(grouped).map(([k, arr]) => {
                if (!arr || arr.length === 0 || k === "other") return null;

                // Render section header + items
                // Need idxFlat mapping for keyboard highlight: compute by scanning flatItems
                return (
                  <div key={k}>
                    <div
                      style={{
                        padding: "10px 12px",
                        fontSize: 12,
                        fontWeight: 800,
                        opacity: 0.8,
                        borderTop: "1px solid rgba(255,255,255,0.10)",
                        background: "rgba(255,255,255,0.03)",
                      }}
                    >
                      {groupLabel(k)}
                    </div>
                    {arr.map((it) => {
                      const idxFlat = flatItems.findIndex((x) => x.id === it.id);
                      return renderItem(it, idxFlat);
                    })}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: "12px" }}>
              {showNoResultsWhileTyping ? (
                <>
                  <div style={{ fontSize: 14, fontWeight: 850 }}>No results found</div>
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                    Try a different spelling or choose from trending.
                  </div>

                  {trend.length > 0 ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>Trending</div>
                      {trend.slice(0, 10).map((t: any) => (
                        <div
                          key={t.id}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => (t.canonical_url ? goToUrl(t.canonical_url, t.name) : submitRawQuery(t.name))}
                          style={{ padding: "8px 6px", cursor: "pointer", borderRadius: 8 }}
                        >
                          <div style={{ fontSize: 14, fontWeight: 650 }}>{t.name}</div>
                          <div style={{ fontSize: 12, opacity: 0.7 }}>
                            {t.entity_type}
                            {t.city ? ` • ${t.city}` : ""}
                            {t.parent_name ? ` • ${t.parent_name}` : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <div style={{ fontSize: 14, opacity: 0.75 }}>No suggestions</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div ref={containerRef} style={{ maxWidth: 760, width: "100%" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <select
          value={cityId}
          onChange={(e) => setCityId(e.target.value)}
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(255,255,255,0.04)",
            color: "inherit",
          }}
        >
          {CITY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          placeholder="Search city, locality, project, builder, rates, properties…"
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(255,255,255,0.04)",
            color: "inherit",
            outline: "none",
          }}
        />

        <button
          onClick={() => submitRawQuery(q)}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.25)",
            background: "rgba(255,255,255,0.10)",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          {loading ? "…" : "Search"}
        </button>
      </div>

      {error ? <div style={{ marginTop: 8, color: "crimson", fontSize: 14 }}>{error}</div> : null}

      {open && anchor && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={dropdownRef}
              onWheelCapture={(e) => e.stopPropagation()}
              style={{
                position: "fixed",
                top: anchor.top,
                left: anchor.left,
                width: anchor.width,
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: 10,
                background: "rgba(20,20,24,0.98)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                overflowY: "auto",
                maxHeight: "min(560px, calc(100vh - 140px))",
                overscrollBehavior: "contain",
                zIndex: 9999,
              }}
            >
              {dropdownInner}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
