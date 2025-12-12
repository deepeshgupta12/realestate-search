"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { resolve, suggest, trending } from "@/lib/api";
import type { SuggestItem, SuggestResponse } from "@/lib/types";

type CityOption = { id: string; name: string };

const CITY_OPTIONS: CityOption[] = [
  { id: "", name: "All Cities" },
  { id: "city_pune", name: "Pune" },
  { id: "city_noida", name: "Noida" },
];

function labelForGroupKey(k: string): string {
  if (k === "locations") return "Locations";
  if (k === "projects") return "Projects";
  if (k === "builders") return "Builders";
  if (k === "rate_pages") return "Property Rates";
  if (k === "property_pdps") return "Properties";
  return "Other";
}

function shortTypeTag(entityType: string): string {
  const t = (entityType || "").toLowerCase();
  if (t === "locality" || t === "micromarket" || t === "city") return "LOC";
  if (t === "project") return "PRJ";
  if (t === "builder") return "BLD";
  if (t === "rate_page") return "RATE";
  if (t === "property_pdp") return "PROP";
  return t ? t.slice(0, 4).toUpperCase() : "ITEM";
}

function metaLine(it: SuggestItem): string {
  const parts: string[] = [];
  if (it.entity_type) parts.push(it.entity_type);
  if (it.city) parts.push(it.city);
  if (it.parent_name) parts.push(it.parent_name);
  return parts.join(" • ");
}

type FlatRow =
  | { kind: "header"; key: string; label: string }
  | { kind: "item"; key: string; group: string; item: SuggestItem }
  | { kind: "action"; key: string; label: string };

type AnchorRect = { left: number; top: number; width: number };

export default function SearchBar({
  initialQuery = "",
  initialCityId = "",
}: {
  initialQuery?: string;
  initialCityId?: string;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [cityId, setCityId] = useState<string>(initialCityId || "");
  const [q, setQ] = useState<string>(initialQuery || "");
  const [open, setOpen] = useState<boolean>(false);

  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<SuggestResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [mounted, setMounted] = useState(false);

  const debRef = useRef<any>(null);

  useEffect(() => setMounted(true), []);

  function computeAnchor() {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Our dropdown should start just below the input row.
    // The input row height is ~38px; plus gap to be safe.
    const top = r.top + 46; // matches our layout (row + spacing)
    setAnchor({ left: r.left, top, width: r.width });
  }

  // Recompute anchor when opening, scrolling, resizing
  useEffect(() => {
    if (!open) return;

    computeAnchor();

    const onResize = () => computeAnchor();
    const onScroll = () => computeAnchor();

    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true); // capture scroll from any parent
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const flatRows: FlatRow[] = useMemo(() => {
    const rows: FlatRow[] = [];
    const r = resp;
    if (!open) return rows;

    if (!q.trim()) {
      rows.push({ kind: "header", key: "hdr_tr", label: "Trending" });
      const items = r?.fallbacks?.trending || [];
      for (const it of items) {
        rows.push({ kind: "item", key: `tr_${it.id}`, group: "trending", item: it });
      }
      rows.push({ kind: "action", key: "act_all_empty", label: "Search all" });
      return rows;
    }

    if (!r) return rows;

    if (r.did_you_mean) {
      rows.push({
        kind: "action",
        key: "act_dym",
        label: `Did you mean ${r.did_you_mean}?`,
      });
    }

    const groups: Array<[string, SuggestItem[]]> = [
      ["locations", r.groups.locations],
      ["projects", r.groups.projects],
      ["builders", r.groups.builders],
      ["rate_pages", r.groups.rate_pages],
      ["property_pdps", r.groups.property_pdps],
    ];

    let any = false;
    for (const [k, items] of groups) {
      if (!items.length) continue;
      any = true;
      rows.push({ kind: "header", key: `hdr_${k}`, label: labelForGroupKey(k) });
      for (const it of items) {
        rows.push({ kind: "item", key: `${k}_${it.id}`, group: k, item: it });
      }
    }

    if (!any) {
      rows.push({ kind: "header", key: "hdr_nr", label: "No results found" });
      const tr = r.fallbacks?.trending || [];
      if (tr.length) {
        rows.push({ kind: "header", key: "hdr_tr2", label: "Trending" });
        for (const it of tr) {
          rows.push({ kind: "item", key: `tr2_${it.id}`, group: "trending", item: it });
        }
      }
    }

    rows.push({ kind: "action", key: "act_all", label: `See all results for "${q.trim()}"` });
    return rows;
  }, [resp, open, q]);

  const selectableIndices = useMemo(() => {
    const idx: number[] = [];
    flatRows.forEach((r, i) => {
      if (r.kind === "item" || r.kind === "action") idx.push(i);
    });
    return idx;
  }, [flatRows]);

  function firstSelectableIndex(): number {
    return selectableIndices.length ? selectableIndices[0] : -1;
  }

  function clampActive(next: number): number {
    if (!selectableIndices.length) return -1;
    const set = new Set(selectableIndices);
    if (set.has(next)) return next;
    return firstSelectableIndex();
  }

  function moveActive(delta: 1 | -1) {
    if (!selectableIndices.length) return;
    const cur = activeIndex;
    if (cur === -1) {
      setActiveIndex(firstSelectableIndex());
      return;
    }
    const pos = selectableIndices.indexOf(cur);
    const nextPos = Math.min(Math.max(pos + delta, 0), selectableIndices.length - 1);
    setActiveIndex(selectableIndices[nextPos]);
  }

  async function ensureBaseTrending() {
    try {
      const tr = await trending(cityId || undefined, 10);
      setResp((prev) => {
        const base: SuggestResponse =
          prev ||
          ({
            q: "",
            normalized_q: "",
            did_you_mean: null,
            groups: { locations: [], projects: [], builders: [], rate_pages: [], property_pdps: [] },
            fallbacks: { relaxed_used: false, trending: [], reason: null },
          } as any);
        return {
          ...base,
          fallbacks: { ...base.fallbacks, trending: tr.items || [] },
        };
      });
    } catch {
      // ignore trending errors
    }
  }

  // Click outside closes dropdown
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const el = containerRef.current;
      if (!el) return;
      if (!el.contains(e.target as any)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function onFocus() {
    setOpen(true);
    setErr(null);
    setActiveIndex(-1);
    computeAnchor();
    if (!q.trim()) await ensureBaseTrending();
  }

  // Debounced suggest
  useEffect(() => {
    if (!open) return;

    const query = q.trim();
    setErr(null);

    if (debRef.current) clearTimeout(debRef.current);

    if (!query) {
      setLoading(false);
      ensureBaseTrending();
      return;
    }

    setLoading(true);

    debRef.current = setTimeout(async () => {
      try {
        const r = await suggest(query, cityId || undefined, 10);

        const noHits =
          r.groups.locations.length === 0 &&
          r.groups.projects.length === 0 &&
          r.groups.builders.length === 0 &&
          r.groups.rate_pages.length === 0 &&
          r.groups.property_pdps.length === 0;

        if (noHits) {
          const tr = await trending(cityId || undefined, 10).catch(() => ({ items: [] as any[] }));
          r.fallbacks.trending = (tr as any).items || [];
          r.fallbacks.relaxed_used = true;
          r.fallbacks.reason = "no_results";
        }

        setResp(r);
        setLoading(false);
        setActiveIndex(-1);
      } catch (e: any) {
        setLoading(false);
        setErr(e?.message || "Suggest failed");
      }
    }, 160);

    return () => {
      if (debRef.current) clearTimeout(debRef.current);
    };
  }, [q, cityId, open]);

  function goSERP(query: string) {
    const params = new URLSearchParams();
    params.set("q", query);
    if (cityId) params.set("city_id", cityId);
    router.push(`/search?${params.toString()}`);
    setOpen(false);
    setActiveIndex(-1);
  }

  async function goResolve(query: string) {
    const r = await resolve(query, cityId || undefined);
    if (r.action === "redirect") {
      router.push(`/go?url=${encodeURIComponent(r.url)}&q=${encodeURIComponent(query)}`);
      setOpen(false);
      setActiveIndex(-1);
    } else {
      goSERP(query);
    }
  }

  function onPickItem(it: SuggestItem) {
    router.push(`/go?url=${encodeURIComponent(it.canonical_url)}&q=${encodeURIComponent(it.name)}`);
    setOpen(false);
    setActiveIndex(-1);
  }

  async function onEnter() {
    if (activeIndex !== -1 && flatRows[activeIndex]) {
      const row = flatRows[activeIndex];
      if (row.kind === "item") {
        onPickItem(row.item);
        return;
      }
      if (row.kind === "action") {
        if (row.key === "act_dym" && resp?.did_you_mean) {
          goSERP(resp.did_you_mean);
          return;
        }
        goSERP(q.trim() || "");
        return;
      }
    }

    const query = q.trim();
    if (!query) return;
    await goResolve(query);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      computeAnchor();
      return;
    }

    if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      onEnter();
      return;
    }
  }

  useEffect(() => {
    if (!open) return;
    if (!flatRows.length) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex((prev) => {
      if (prev === -1) return -1;
      return clampActive(prev);
    });
  }, [flatRows, open]);

  const dropdown =
    open && mounted && anchor
      ? createPortal(
          <div
            style={{
              position: "fixed",
              left: anchor.left,
              top: anchor.top,
              width: anchor.width,
              zIndex: 9999,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(20,20,22,0.95)",
              boxShadow: "0 20px 50px rgba(0,0,0,0.55)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                maxHeight: 360,
                overflowY: "auto",
                overscrollBehavior: "contain",
              }}
              onWheel={(e) => {
                // prevent page scroll while dropdown scrolls
                e.stopPropagation();
              }}
            >
              {loading ? (
                <div style={{ padding: 12, fontSize: 13, opacity: 0.8 }}>Loading…</div>
              ) : null}

              {err ? (
                <div style={{ padding: 12, fontSize: 13, color: "crimson" }}>{err}</div>
              ) : null}

              {flatRows.length === 0 && !loading ? (
                <div style={{ padding: 12, fontSize: 13, opacity: 0.75 }}>
                  Start typing to see suggestions.
                </div>
              ) : null}

              {flatRows.map((row, idx) => {
                if (row.kind === "header") {
                  return (
                    <div
                      key={row.key}
                      style={{
                        padding: "10px 12px 6px",
                        fontSize: 12,
                        fontWeight: 850,
                        opacity: 0.85,
                        borderTop: "1px solid rgba(255,255,255,0.06)",
                      }}
                    >
                      {row.label}
                    </div>
                  );
                }

                const isActive = idx === activeIndex;

                if (row.kind === "action") {
                  const isDym = row.key === "act_dym";
                  return (
                    <div
                      key={row.key}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (isDym && resp?.did_you_mean) {
                          goSERP(resp.did_you_mean);
                        } else {
                          goSERP(q.trim() || "");
                        }
                      }}
                      style={{
                        padding: "12px",
                        cursor: "pointer",
                        background: isActive ? "rgba(138,180,255,0.18)" : "transparent",
                        borderTop: "1px solid rgba(255,255,255,0.06)",
                        fontSize: 13,
                        fontWeight: 750,
                        color: isDym ? "#8ab4ff" : "inherit",
                      }}
                    >
                      {row.label}
                    </div>
                  );
                }

                const it = row.item;
                return (
                  <div
                    key={row.key}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onPickItem(it)}
                    style={{
                      padding: "10px 12px",
                      cursor: "pointer",
                      background: isActive ? "rgba(138,180,255,0.18)" : "transparent",
                      borderTop: "1px solid rgba(255,255,255,0.06)",
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                    }}
                  >
                    <div
                      style={{
                        minWidth: 40,
                        height: 20,
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.18)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        opacity: 0.9,
                        padding: "0 8px",
                        marginTop: 2,
                      }}
                    >
                      {shortTypeTag(it.entity_type)}
                    </div>

                    <div style={{ lineHeight: 1.15 }}>
                      <div style={{ fontSize: 13, fontWeight: 850 }}>{it.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                        {metaLine(it)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                padding: "8px 12px",
                fontSize: 11,
                opacity: 0.65,
                borderTop: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              ↑↓ to navigate • Enter to select • Esc to close
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <div ref={containerRef} style={{ position: "relative" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select
            value={cityId}
            onChange={(e) => setCityId(e.target.value)}
            style={{
              height: 38,
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.06)",
              color: "inherit",
              padding: "0 10px",
              outline: "none",
            }}
            aria-label="City"
          >
            {CITY_OPTIONS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={onFocus}
            onKeyDown={onKeyDown}
            placeholder="Search city, locality, project, builder, rates, properties…"
            style={{
              flex: 1,
              height: 38,
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.06)",
              color: "inherit",
              padding: "0 12px",
              outline: "none",
            }}
          />

          <button
            onClick={() => onEnter()}
            style={{
              height: 38,
              padding: "0 14px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.06)",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            Search
          </button>
        </div>
      </div>

      {dropdown}
    </>
  );
}
