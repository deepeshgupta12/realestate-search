"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import SearchBar from "@/components/SearchBar";
import { search as searchApi } from "@/lib/api";
import type { SuggestItem, SuggestResponse } from "@/lib/types";

function groupLabel(k: string): string {
  if (k === "locations") return "Locations";
  if (k === "projects") return "Projects";
  if (k === "builders") return "Builders";
  if (k === "rate_pages") return "Property Rates";
  if (k === "property_pdps") return "Properties";
  return "Other";
}

function itemMeta(it: SuggestItem): string {
  const parts: string[] = [];
  if (it.entity_type) parts.push(it.entity_type);
  if (it.city) parts.push(it.city);
  if (it.parent_name) parts.push(it.parent_name);
  return parts.join(" • ");
}

export default function SearchPage() {
  const sp = useSearchParams();
  const q = (sp.get("q") || "").trim();
  const cityId = (sp.get("city_id") || "").trim();

  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<SuggestResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!q) {
      setResp(null);
      setErr(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErr(null);

    searchApi(q, cityId || undefined, 50)
      .then((r) => {
        if (cancelled) return;
        setResp(r);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setErr(e?.message || "Search failed");
        setResp(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [q, cityId]);

  const total = useMemo(() => {
    if (!resp) return 0;
    return (
      resp.groups.locations.length +
      resp.groups.projects.length +
      resp.groups.builders.length +
      resp.groups.rate_pages.length +
      resp.groups.property_pdps.length
    );
  }, [resp]);

  return (
    <div style={{ minHeight: "100vh", padding: "56px 16px", display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 860 }}>
        <div style={{ marginBottom: 14 }}>
          <SearchBar initialQuery={q} initialCityId={cityId} />
        </div>

        {!q ? (
          <div style={{ marginTop: 18, fontSize: 14, opacity: 0.75 }}>
            Type a query above to search.
          </div>
        ) : null}

        {loading ? (
          <div style={{ marginTop: 18, fontSize: 14, opacity: 0.8 }}>Loading…</div>
        ) : null}

        {err ? (
          <div style={{ marginTop: 18, fontSize: 14, color: "crimson" }}>{err}</div>
        ) : null}

        {resp && !loading ? (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 14, opacity: 0.75, marginBottom: 8 }}>
              Query: <b>{resp.normalized_q}</b>
            </div>
            <div style={{ fontSize: 14, opacity: 0.75, marginBottom: 18 }}>
              Results: <b>{total}</b>
            </div>

            {resp.did_you_mean ? (
              <div
                style={{
                  padding: "12px 14px",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.04)",
                  marginBottom: 16,
                  fontSize: 14,
                }}
              >
                Did you mean{" "}
                <a
                  href={`/search?q=${encodeURIComponent(resp.did_you_mean)}${cityId ? `&city_id=${encodeURIComponent(cityId)}` : ""}`}
                  style={{ color: "#8ab4ff", textDecoration: "none", fontWeight: 750 }}
                >
                  {resp.did_you_mean}
                </a>
                ?
              </div>
            ) : null}

            {total === 0 ? (
              <div
                style={{
                  padding: "14px",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.04)",
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 850 }}>No results found</div>
                <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>
                  {resp.fallbacks?.relaxed_used
                    ? `Tried relaxed matching. Reason: ${resp.fallbacks.reason || "no_results"}`
                    : "Try a different spelling or explore trending."}
                </div>

                {resp.fallbacks?.trending?.length ? (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 10 }}>Trending</div>
                    <div style={{ display: "grid", gap: 10 }}>
                      {resp.fallbacks.trending.map((t) => (
                        <a
                          key={t.id}
                          href={`/go?url=${encodeURIComponent(t.canonical_url)}&q=${encodeURIComponent(t.name)}`}
                          style={{
                            display: "block",
                            padding: "12px",
                            borderRadius: 12,
                            border: "1px solid rgba(255,255,255,0.14)",
                            background: "rgba(0,0,0,0.12)",
                            textDecoration: "none",
                            color: "inherit",
                          }}
                        >
                          <div style={{ fontSize: 14, fontWeight: 800 }}>{t.name}</div>
                          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>{itemMeta(t)}</div>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 18 }}>
                {Object.entries(resp.groups).map(([k, arr]) => {
                  if (!arr.length) return null;
                  return (
                    <div key={k}>
                      <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 10 }}>{groupLabel(k)}</div>
                      <div style={{ display: "grid", gap: 10 }}>
                        {arr.map((it) => (
                          <a
                            key={it.id}
                            href={`/go?url=${encodeURIComponent(it.canonical_url)}&q=${encodeURIComponent(it.name)}`}
                            style={{
                              display: "block",
                              padding: "14px",
                              borderRadius: 12,
                              border: "1px solid rgba(255,255,255,0.14)",
                              background: "rgba(0,0,0,0.12)",
                              textDecoration: "none",
                              color: "inherit",
                            }}
                          >
                            <div style={{ fontSize: 14, fontWeight: 850 }}>{it.name}</div>
                            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>{itemMeta(it)}</div>
                            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                              URL: <span style={{ opacity: 0.9 }}>{it.canonical_url}</span>
                            </div>
                          </a>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
