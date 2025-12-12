"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { resolve, suggest } from "@/lib/api";
import type { SuggestItem, SuggestResponse } from "@/lib/types";

type Props = {
  initialQuery?: string;
};

const CITY_OPTIONS = [
  { label: "All Cities", value: "" },
  { label: "Pune", value: "city_pune" },
  { label: "Noida", value: "city_noida" },
];

function flattenGroups(r: SuggestResponse | null): SuggestItem[] {
  if (!r) return [];
  return [
    ...r.groups.locations,
    ...r.groups.projects,
    ...r.groups.builders,
    ...r.groups.rate_pages,
    ...r.groups.property_pdps,
  ];
}

function groupLabel(entityType: string): string {
  if (["city", "micromarket", "locality", "listing_page", "locality_overview"].includes(entityType)) return "Locations";
  if (entityType === "project") return "Projects";
  if (entityType === "builder") return "Builders";
  if (entityType === "rate_page") return "Property Rates";
  if (entityType === "property_pdp") return "Properties";
  return "Other";
}

export default function SearchBar({ initialQuery }: Props) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery || "");
  const [cityId, setCityId] = useState("");
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<SuggestResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [error, setError] = useState<string | null>(null);

  const lastReq = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const items = useMemo(() => flattenGroups(resp), [resp]);

  // Debounced suggest
  useEffect(() => {
    const query = q.trim();
    if (query.length < 1) {
      setResp(null);
      setOpen(false);
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
          setOpen(false);
        })
        .finally(() => {
          if (reqId !== lastReq.current) return;
          setLoading(false);
        });
    }, 150);

    return () => clearTimeout(t);
  }, [q, cityId]);

  async function submit(query: string) {
    const queryTrim = query.trim();
    if (!queryTrim) return;

    setLoading(true);
    setError(null);

    try {
      const r = await resolve(queryTrim, cityId || undefined);

      if (r.action === "redirect") {
        // Demo "redirect" page in our local app
        router.push(`/go?url=${encodeURIComponent(r.url)}&q=${encodeURIComponent(queryTrim)}`);
        return;
      }

      if (r.action === "disambiguate") {
        router.push(`/search?q=${encodeURIComponent(queryTrim)}&city_id=${encodeURIComponent(cityId)}`);
        return;
      }

      // serp
      const params = new URLSearchParams({ q: queryTrim });
      if (cityId) params.set("city_id", cityId);
      router.push(`/search?${params.toString()}`);
    } catch (e: any) {
      setError(e.message || "Resolve failed");
    } finally {
      setLoading(false);
      setOpen(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || items.length === 0) {
      if (e.key === "Enter") submit(q);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((v) => Math.min(v + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((v) => Math.max(v - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = activeIdx >= 0 ? items[activeIdx] : null;
      submit(selected ? selected.name : q);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    }
  }

  function pick(item: SuggestItem) {
    setQ(item.name);
    setOpen(false);
    submit(item.name);
  }

  return (
    <div style={{ maxWidth: 760, width: "100%", position: "relative" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <select
          value={cityId}
          onChange={(e) => setCityId(e.target.value)}
          style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd" }}
        >
          {CITY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>

        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => q.trim() && setOpen(true)}
          placeholder="Search city, locality, project, builder, rates, properties…"
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #ddd",
            outline: "none",
          }}
        />

        <button
          onClick={() => submit(q)}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #222",
            background: "#222",
            color: "white",
            cursor: "pointer",
          }}
        >
          {loading ? "…" : "Search"}
        </button>
      </div>

      {error ? (
        <div style={{ marginTop: 8, color: "crimson", fontSize: 14 }}>{error}</div>
      ) : null}

      {open && (resp?.did_you_mean || items.length > 0) ? (
        <div
          style={{
            position: "absolute",
            top: 46,
            left: 0,
            right: 0,
            border: "1px solid #e5e5e5",
            borderRadius: 10,
            background: "white",
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            overflow: "hidden",
            zIndex: 50,
          }}
        >
          {resp?.did_you_mean ? (
            <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", fontSize: 14 }}>
              Did you mean{" "}
              <button
                onClick={() => submit(resp.did_you_mean!)}
                style={{ border: "none", background: "transparent", color: "#0b57d0", cursor: "pointer" }}
              >
                {resp.did_you_mean}
              </button>
              ?
            </div>
          ) : null}

          {items.length === 0 ? (
            <div style={{ padding: "12px", fontSize: 14, color: "#666" }}>No suggestions</div>
          ) : (
            <div>
              {items.map((it, idx) => (
                <div
                  key={it.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(it)}
                  style={{
                    padding: "10px 12px",
                    cursor: "pointer",
                    background: idx === activeIdx ? "#f5f7ff" : "white",
                    borderBottom: "1px solid #f2f2f2",
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{it.name}</div>
                  <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                    {groupLabel(it.entity_type)}
                    {it.city ? ` • ${it.city}` : ""}
                    {it.parent_name ? ` • ${it.parent_name}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
