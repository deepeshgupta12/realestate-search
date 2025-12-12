"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import SearchBar from "@/components/SearchBar";
import { search } from "@/lib/api";
import type { SearchResponse, SuggestItem } from "@/lib/types";

function Section({ title, items }: { title: string; items: SuggestItem[] }) {
  if (!items.length) return null;
  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ fontSize: 16, marginBottom: 8 }}>{title}</h2>
      <div style={{ border: "1px solid #eee", borderRadius: 10, overflow: "hidden" }}>
        {items.map((it) => (
          <div key={it.id} style={{ padding: "10px 12px", borderBottom: "1px solid #f2f2f2" }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{it.name}</div>
            <div style={{ color: "#666", fontSize: 12, marginTop: 2 }}>
              {it.entity_type}
              {it.city ? ` • ${it.city}` : ""}
              {it.parent_name ? ` • ${it.parent_name}` : ""}
            </div>
            <div style={{ fontSize: 12, marginTop: 6 }}>
              <span style={{ color: "#666" }}>URL:</span> <code>{it.canonical_url}</code>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function SearchPage() {
  const sp = useSearchParams();
  const q = sp.get("q") || "";
  const cityId = sp.get("city_id") || "";

  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!q.trim()) return;
    setLoading(true);
    setErr(null);
    search(q, cityId || undefined, 20)
      .then(setData)
      .catch((e) => setErr(e.message || "Search failed"))
      .finally(() => setLoading(false));
  }, [q, cityId]);

  const total = useMemo(() => {
    if (!data) return 0;
    return (
      data.groups.locations.length +
      data.groups.projects.length +
      data.groups.builders.length +
      data.groups.rate_pages.length +
      data.groups.property_pdps.length
    );
  }, [data]);

  return (
    <main style={{ padding: "28px 20px", display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 900 }}>
        <SearchBar initialQuery={q} />

        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 14, color: "#666" }}>
            Query: <b>{q}</b> {cityId ? <span>• City: <b>{cityId}</b></span> : null}
          </div>
        </div>

        {loading ? <div style={{ marginTop: 18 }}>Loading…</div> : null}
        {err ? <div style={{ marginTop: 18, color: "crimson" }}>{err}</div> : null}

        {data?.did_you_mean ? (
          <div style={{ marginTop: 14, fontSize: 14 }}>
            Did you mean <b>{data.did_you_mean}</b>?
          </div>
        ) : null}

        {data && total === 0 ? (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontWeight: 700 }}>No results found</div>
            <div style={{ color: "#666", marginTop: 6, fontSize: 14 }}>
              {data.fallbacks.relaxed_used ? "Tried relaxed matching." : null}
              {data.fallbacks.reason ? ` Reason: ${data.fallbacks.reason}` : null}
            </div>

            {data.fallbacks.trending?.length ? (
              <section style={{ marginTop: 16 }}>
                <h2 style={{ fontSize: 16, marginBottom: 8 }}>Trending</h2>
                <div style={{ border: "1px solid #eee", borderRadius: 10, overflow: "hidden" }}>
                  {data.fallbacks.trending.map((t) => (
                    <div key={t.id} style={{ padding: "10px 12px", borderBottom: "1px solid #f2f2f2" }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{t.name}</div>
                      <div style={{ color: "#666", fontSize: 12, marginTop: 2 }}>
                        {t.entity_type}
                        {t.city ? ` • ${t.city}` : ""}
                        {t.parent_name ? ` • ${t.parent_name}` : ""}
                      </div>
                      <div style={{ fontSize: 12, marginTop: 6 }}>
                        <span style={{ color: "#666" }}>URL:</span> <code>{t.canonical_url}</code>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {data && total > 0 ? (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 14, color: "#666" }}>Results: <b>{total}</b></div>

            <Section title="Locations" items={data.groups.locations} />
            <Section title="Projects" items={data.groups.projects} />
            <Section title="Builders" items={data.groups.builders} />
            <Section title="Property Rates" items={data.groups.rate_pages} />
            <Section title="Properties" items={data.groups.property_pdps} />
          </div>
        ) : null}
      </div>
    </main>
  );
}
