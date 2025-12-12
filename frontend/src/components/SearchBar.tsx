"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import type { SuggestItem, SuggestResponse, TrendingResponse } from "@/lib/types";

const CITY_OPTIONS = [
  { id: "", name: "All Cities" },
  { id: "city_pune", name: "Pune" },
  { id: "city_noida", name: "Noida" },
];

function isEmptyGroups(r: SuggestResponse): boolean {
  const g = r.groups;
  return (
    g.locations.length === 0 &&
    g.projects.length === 0 &&
    g.builders.length === 0 &&
    g.rate_pages.length === 0 &&
    g.property_pdps.length === 0
  );
}

function badgeFor(entityType: string): string {
  switch (entityType) {
    case "locality":
      return "LOC";
    case "micromarket":
      return "MM";
    case "city":
      return "CITY";
    case "project":
      return "PRJ";
    case "builder":
      return "BLD";
    case "rate_page":
      return "RATE";
    case "property_pdp":
      return "PROP";
    default:
      return entityType.toUpperCase().slice(0, 4);
  }
}

function highlight(text: string, q: string): React.ReactNode {
  const needle = q.trim();
  if (!needle) return text;
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return text;
  const before = text.slice(0, idx);
  const hit = text.slice(idx, idx + needle.length);
  const after = text.slice(idx + needle.length);
  return (
    <>
      {before}
      <mark>{hit}</mark>
      {after}
    </>
  );
}

function formatMeta(it: SuggestItem): string {
  const parts: string[] = [];
  if (it.entity_type) parts.push(it.entity_type);
  const city = (it.city || "").trim();
  if (city) parts.push(city);
  const parent = (it.parent_name || "").trim();
  if (parent) parts.push(parent);
  return parts.join(" • ");
}

export default function SearchBar({
  initialQ = "",
  initialCityId = "",
}: {
  initialQ?: string;
  initialCityId?: string;
}) {
  const router = useRouter();

  const [q, setQ] = React.useState(initialQ);
  const [cityId, setCityId] = React.useState(initialCityId);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const [didYouMean, setDidYouMean] = React.useState<string | null>(null);
  const [sections, setSections] = React.useState<
    Array<{ title: string; items: SuggestItem[] }>
  >([]);
  const [noResults, setNoResults] = React.useState(false);
  const [trending, setTrending] = React.useState<SuggestItem[]>([]);
  const boxRef = React.useRef<HTMLDivElement | null>(null);

  const debounceRef = React.useRef<number | null>(null);

  async function loadTrending(nextCityId: string) {
    const r = await apiGet<TrendingResponse>("/api/v1/search/trending", {
      city_id: nextCityId || undefined,
      limit: 8,
    });
    setTrending(r.items || []);
  }

  function goToSerp(query: string, nextCityId: string) {
    const qp = new URLSearchParams();
    qp.set("q", query);
    if (nextCityId) qp.set("city_id", nextCityId);
    router.push(`/search?${qp.toString()}`);
    setOpen(false);
  }

  function goToUrl(url: string, query: string) {
    const qp = new URLSearchParams();
    qp.set("url", url);
    qp.set("q", query);
    router.push(`/go?${qp.toString()}`);
    setOpen(false);
  }

  async function refreshDropdown(nextQ: string, nextCityId: string) {
    const trimmed = nextQ.trim();
    setLoading(true);
    setNoResults(false);
    setDidYouMean(null);
    setSections([]);

    try {
      if (!trimmed) {
        await loadTrending(nextCityId);
        setOpen(true);
        return;
      }

      const r = await apiGet<SuggestResponse>("/api/v1/search/suggest", {
        q: trimmed,
        city_id: nextCityId || undefined,
        limit: 10,
      });

      setDidYouMean(r.did_you_mean);

      const s: Array<{ title: string; items: SuggestItem[] }> = [];
      if (r.groups.locations.length) s.push({ title: "Locations", items: r.groups.locations });
      if (r.groups.projects.length) s.push({ title: "Projects", items: r.groups.projects });
      if (r.groups.builders.length) s.push({ title: "Builders", items: r.groups.builders });
      if (r.groups.rate_pages.length) s.push({ title: "Property Rates", items: r.groups.rate_pages });
      if (r.groups.property_pdps.length) s.push({ title: "Properties", items: r.groups.property_pdps });

      setSections(s);

      const empty = isEmptyGroups(r);
      if (empty) {
        setNoResults(true);
        // Prefer backend-provided trending fallback; else fetch trending
        if (r.fallbacks?.trending?.length) {
          setTrending(r.fallbacks.trending);
        } else {
          await loadTrending(nextCityId);
        }
      }

      setOpen(true);
    } finally {
      setLoading(false);
    }
  }

  function onChange(next: string) {
    setQ(next);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      refreshDropdown(next, cityId).catch(() => {
        setNoResults(true);
        setSections([]);
        setDidYouMean(null);
        setOpen(true);
      });
    }, 180);
  }

  function onSubmit() {
    const trimmed = q.trim();
    if (!trimmed) {
      setOpen(true);
      return;
    }
    goToSerp(trimmed, cityId);
  }

  React.useEffect(() => {
    // close on outside click
    function onDocClick(e: MouseEvent) {
      const el = boxRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  React.useEffect(() => {
    // ensure trending loaded for empty query on first focus
    if (!q.trim()) {
      loadTrending(cityId).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="searchWrap" ref={boxRef}>
      <div className="controls">
        <select
          className="select"
          value={cityId}
          onChange={(e) => {
            const nextCityId = e.target.value;
            setCityId(nextCityId);
            // refresh dropdown based on current query
            refreshDropdown(q, nextCityId).catch(() => {});
          }}
        >
          {CITY_OPTIONS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <input
          className="input"
          placeholder="Search city, locality, project, builder, rates, properties..."
          value={q}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            refreshDropdown(q, cityId).catch(() => setOpen(true));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
        />

        <button className="btn" onClick={onSubmit}>
          Search
        </button>
      </div>

      {open && (
        <div
          className="dropdown"
          onWheel={(e) => {
            // Critical: stop wheel events from scrolling the whole page behind the dropdown.
            e.stopPropagation();
          }}
        >
          {loading && <div className="sectionTitle">Loading…</div>}

          {!loading && didYouMean && q.trim() && didYouMean.toLowerCase() !== q.trim().toLowerCase() && (
            <div className="didYouMean">
              Did you mean <strong>{didYouMean}</strong>?
            </div>
          )}

          {!loading && sections.map((sec) => (
            <div key={sec.title}>
              <div className="sectionTitle">{sec.title}</div>
              {sec.items.map((it) => (
                <div
                  key={it.id}
                  className="item"
                  onClick={() => goToUrl(it.canonical_url, q.trim())}
                >
                  <div className="badge">{badgeFor(it.entity_type)}</div>
                  <div className="itemMain">
                    <div className="itemName">{highlight(it.name, q)}</div>
                    <div className="itemMeta">{formatMeta(it)}</div>
                  </div>
                </div>
              ))}
            </div>
          ))}

          {!loading && noResults && (
            <div>
              <div className="sectionTitle">No results found</div>
              <div className="didYouMean">Try a different spelling or choose from trending.</div>
              <div className="sectionTitle">Trending</div>
              {trending.map((it) => (
                <div
                  key={it.id}
                  className="item"
                  onClick={() => goToUrl(it.canonical_url, q.trim() || it.name)}
                >
                  <div className="badge">{badgeFor(it.entity_type)}</div>
                  <div className="itemMain">
                    <div className="itemName">{it.name}</div>
                    <div className="itemMeta">{formatMeta(it)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && !q.trim() && trending.length > 0 && (
            <div>
              <div className="sectionTitle">Trending</div>
              {trending.map((it) => (
                <div
                  key={it.id}
                  className="item"
                  onClick={() => goToUrl(it.canonical_url, it.name)}
                >
                  <div className="badge">{badgeFor(it.entity_type)}</div>
                  <div className="itemMain">
                    <div className="itemName">{it.name}</div>
                    <div className="itemMeta">{formatMeta(it)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div
            className="footerAction"
            onClick={() => goToSerp(q.trim() || "", cityId)}
          >
            See all results for "{(q.trim() || "").slice(0, 80)}"
          </div>
        </div>
      )}
    </div>
  );
}