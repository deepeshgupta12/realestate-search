// frontend/src/app/disambiguate/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";

type EntityOut = {
  id: string;
  entity_type: string;
  name: string;
  city: string;
  city_id: string;
  parent_name?: string;
  canonical_url: string;
  score?: number | null;
  popularity_score?: number | null;
};

type ResolveResponse = {
  action: "redirect" | "serp" | "disambiguate";
  query: string;
  normalized_query: string;
  url: string | null;
  match: EntityOut | null;
  candidates: EntityOut[] | null;
  reason: string | null;
  debug: any | null;
};

export default function DisambiguatePage() {
  const router = useRouter();
  const sp = useSearchParams();

  const q = sp.get("q") || "";
  const qid = sp.get("qid") || ""; // for click attribution
  const city_id = sp.get("city_id") || "";
  const context_url = sp.get("context_url") || "/";

  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<EntityOut[]>([]);
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => {
    const cleaned = q.trim();
    return cleaned ? `Which "${cleaned}" did you mean?` : "Choose one";
  }, [q]);

  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        const resp = await apiGet<ResolveResponse>("/search/resolve", {
          q,
          city_id: city_id || undefined,
          context_url: context_url || undefined,
        });

        if (!alive) return;

        if (resp.action === "redirect" && resp.url) {
          router.replace(resp.url);
          return;
        }

        if (resp.action === "serp") {
          router.replace(resp.url || `/search?q=${encodeURIComponent(q)}`);
          return;
        }

        setCandidates(resp.candidates || []);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Failed to load disambiguation candidates");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [q, city_id, context_url, router]);

  async function onPick(item: EntityOut, rank: number) {
    // Log click best-effort, then navigate.
    try {
      if (qid) {
        await apiPost<{ ok: boolean }>("/events/click", {
          query_id: qid,
          entity_id: item.id,
          entity_type: item.entity_type,
          rank,
          url: item.canonical_url,
          city_id: city_id || null,
          context_url: context_url || null,
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      // ignore logging failures
    } finally {
      router.push(item.canonical_url);
    }
  }

  return (
    <div style={{ maxWidth: 860, margin: "24px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>{title}</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Select the correct place to continue.
      </p>

      {loading && <div>Loading…</div>}

      {!loading && error && (
        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>Error</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{error}</div>
          <div style={{ marginTop: 12 }}>
            <button onClick={() => router.push(`/search?q=${encodeURIComponent(q)}`)}>
              Go to results
            </button>
          </div>
        </div>
      )}

      {!loading && !error && candidates.length === 0 && (
        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>No candidates</div>
          <div>We couldn’t find matching pages. Try the results page.</div>
          <div style={{ marginTop: 12 }}>
            <button onClick={() => router.push(`/search?q=${encodeURIComponent(q)}`)}>
              Go to results
            </button>
          </div>
        </div>
      )}

      {!loading && !error && candidates.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {candidates.map((c, idx) => (
            <button
              key={c.id}
              onClick={() => onPick(c, idx + 1)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "12px 14px",
                marginBottom: 10,
                border: "1px solid #e5e5e5",
                borderRadius: 10,
                background: "white",
                cursor: "pointer",
              }}
            >
              <div style={{ fontWeight: 700 }}>
                {c.name}{" "}
                <span style={{ fontWeight: 500, opacity: 0.7 }}>
                  ({c.entity_type})
                </span>
              </div>
              <div style={{ opacity: 0.85, marginTop: 4 }}>
                {c.city ? `${c.city}` : ""}{" "}
                {c.parent_name ? `• ${c.parent_name}` : ""}
              </div>
              <div style={{ opacity: 0.6, marginTop: 4, fontSize: 12 }}>
                {c.canonical_url}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}