"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";

// Keep this local + defensive so TS types never block compilation.
type EntityOut = {
  id: string;
  entity_type: string;
  name: string;
  city?: string | null;
  city_id?: string | null;
  parent_name?: string | null;
  canonical_url: string;
  popularity_score?: number | null;
  score?: number | null;
};

type SuggestResponse = {
  q: string;
  normalized_q: string;
  did_you_mean?: string | null;
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
  };
};

type ZeroStateResponse = {
  city_id: string | null;
  recent_searches: string[];
  trending_searches: EntityOut[];
  trending_localities: EntityOut[];
  popular_entities: EntityOut[];
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000/api/v1";

function nowIso() {
  return new Date().toISOString();
}

function normQuery(q: string) {
  return q.trim().toLowerCase();
}

async function bestEffortPost(path: string, body: any) {
  try {
    await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // swallow on purpose (best-effort)
  }
}

export default function SearchBar() {
  const router = useRouter();

  const [q, setQ] = useState("");
  const [cityId, setCityId] = useState<string>(""); // "" = all
  const [open, setOpen] = useState(false);

  const [zero, setZero] = useState<ZeroStateResponse | null>(null);
  const [suggest, setSuggest] = useState<SuggestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Latest “query id” to associate clicks with this typing session.
  const sessionQidRef = useRef<string | null>(null);

  const qTrim = q.trim();

  // Fetch zero-state when input becomes empty / dropdown opens
  useEffect(() => {
    if (!open) return;

    if (qTrim.length > 0) return;

    const controller = new AbortController();
    (async () => {
      setErr(null);
      try {
        const qs = new URLSearchParams();
        if (cityId) qs.set("city_id", cityId);
        qs.set("limit", "8");
        const res = await apiGet<ZeroStateResponse>(`/search/zero-state?${qs.toString()}`);
        setZero(res);
      } catch (e: any) {
        setErr(`GET /search/zero-state failed: ${e?.message ?? String(e)}`);
      }
    })();

    return () => controller.abort();
  }, [open, qTrim, cityId]);

  // Suggest as you type
  useEffect(() => {
    if (!open) return;

    if (qTrim.length === 0) {
      setSuggest(null);
      return;
    }

    const controller = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setErr(null);
      try {
        const qs = new URLSearchParams();
        qs.set("q", qTrim);
        if (cityId) qs.set("city_id", cityId);
        qs.set("limit", "10");
        const res = await apiGet<SuggestResponse>(`/search/suggest?${qs.toString()}`);
        setSuggest(res);
      } catch (e: any) {
        setErr(`GET /search/suggest failed: ${e?.message ?? String(e)}`);
        setSuggest(null);
      } finally {
        setLoading(false);
      }
    }, 120);

    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [open, qTrim, cityId]);

  function ensureSessionQid() {
    if (!sessionQidRef.current) {
      sessionQidRef.current = crypto.randomUUID();
    }
    return sessionQidRef.current;
  }

  async function onPickEntity(entity: EntityOut, rank: number) {
    const qid = ensureSessionQid();
    const raw = qTrim || entity.name;

    // Best-effort: log "search" event for this session (so click has a parent query_id).
    await bestEffortPost("/events/search", {
      query_id: qid,
      raw_query: raw,
      normalized_query: normQuery(raw),
      city_id: cityId || null,
      context_url: "/",
      timestamp: nowIso(),
    });

    const qs = new URLSearchParams();
    qs.set("url", entity.canonical_url);
    qs.set("qid", qid);
    qs.set("entity_id", entity.id);
    qs.set("entity_type", entity.entity_type);
    qs.set("rank", String(rank));
    if (cityId) qs.set("city_id", cityId);
    qs.set("context_url", "/");

    setOpen(false);
    router.push(`/go?${qs.toString()}`);
  }

  function onSeeAllResults() {
    const qid = ensureSessionQid();
    const qs = new URLSearchParams();
    qs.set("q", qTrim);
    if (cityId) qs.set("city_id", cityId);
    qs.set("qid", qid);
    setOpen(false);
    router.push(`/search?${qs.toString()}`);
  }

  // Render helpers
  const groups = useMemo(() => {
    const g = suggest?.groups;
    return {
      locations: g?.locations ?? [],
      rate_pages: g?.rate_pages ?? [],
      property_pdps: g?.property_pdps ?? [],
      projects: g?.projects ?? [],
      builders: g?.builders ?? [],
    };
  }, [suggest]);

  return (
    <div style={{ width: "100%", maxWidth: 920 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <select
          value={cityId || ""}
          onChange={(e) => setCityId(e.target.value)}
          style={{ height: 36 }}
          onFocus={() => setOpen(true)}
        >
          <option value="">All Cities</option>
          <option value="city_pune">Pune</option>
          <option value="city_noida">Noida</option>
        </select>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter") onSeeAllResults();
          }}
          placeholder="Search city, locality, project…"
          style={{ flex: 1, height: 36, padding: "0 10px" }}
        />

        <button type="button" onClick={onSeeAllResults} style={{ height: 36, padding: "0 14px" }}>
          Search
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 8, border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: 12 }}>
          {err && <div style={{ marginBottom: 8 }}>{err}</div>}
          {loading && <div style={{ marginBottom: 8, opacity: 0.85 }}>Loading…</div>}

          {/* ZERO STATE */}
          {qTrim.length === 0 && zero && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Trending</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {zero.trending_searches.map((e, idx) => (
                  <button
                    key={`${e.id}-${idx}`}
                    type="button"
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => onPickEntity(e, idx + 1)}
                    style={{ padding: "6px 10px" }}
                  >
                    {e.name} <span style={{ opacity: 0.7 }}>· {e.entity_type}</span>
                  </button>
                ))}
              </div>

              <div style={{ fontWeight: 700, marginTop: 12, marginBottom: 8 }}>Popular localities</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {zero.trending_localities.map((e, idx) => (
                  <button
                    key={`${e.id}-${idx}`}
                    type="button"
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => onPickEntity(e, idx + 1)}
                    style={{ padding: "6px 10px" }}
                  >
                    {e.name} <span style={{ opacity: 0.7 }}>· {e.city}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* SUGGEST GROUPS */}
          {qTrim.length > 0 && (
            <div>
              {groups.locations.length > 0 && (
                <>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Locations</div>
                  {groups.locations.map((e, idx) => (
                    <div key={`${e.id}-${idx}`}>
                      <button
                        type="button"
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => onPickEntity(e, idx + 1)}
                        style={{ width: "100%", textAlign: "left", padding: "8px 10px" }}
                      >
                        <div style={{ fontWeight: 600 }}>{e.name}</div>
                        <div style={{ opacity: 0.75, fontSize: 12 }}>
                          {e.entity_type} · {e.city} · {e.parent_name}
                        </div>
                      </button>
                    </div>
                  ))}
                </>
              )}

              {groups.rate_pages.length > 0 && (
                <>
                  <div style={{ fontWeight: 700, marginTop: 10, marginBottom: 6 }}>Property Rates</div>
                  {groups.rate_pages.map((e, idx) => (
                    <div key={`${e.id}-${idx}`}>
                      <button
                        type="button"
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => onPickEntity(e, idx + 1)}
                        style={{ width: "100%", textAlign: "left", padding: "8px 10px" }}
                      >
                        <div style={{ fontWeight: 600 }}>{e.name}</div>
                        <div style={{ opacity: 0.75, fontSize: 12 }}>
                          {e.entity_type} · {e.city} · {e.parent_name}
                        </div>
                      </button>
                    </div>
                  ))}
                </>
              )}

              {groups.property_pdps.length > 0 && (
                <>
                  <div style={{ fontWeight: 700, marginTop: 10, marginBottom: 6 }}>Properties</div>
                  {groups.property_pdps.map((e, idx) => (
                    <div key={`${e.id}-${idx}`}>
                      <button
                        type="button"
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => onPickEntity(e, idx + 1)}
                        style={{ width: "100%", textAlign: "left", padding: "8px 10px" }}
                      >
                        <div style={{ fontWeight: 600 }}>{e.name}</div>
                        <div style={{ opacity: 0.75, fontSize: 12 }}>
                          {e.entity_type} · {e.city} · {e.parent_name}
                        </div>
                      </button>
                    </div>
                  ))}
                </>
              )}

              <div style={{ marginTop: 10, borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 10 }}>
                <button type="button" onClick={onSeeAllResults} style={{ padding: "8px 10px", width: "100%", textAlign: "left" }}>
                  See all results for "{qTrim}"
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}