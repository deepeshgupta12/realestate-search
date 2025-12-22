"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type SuggestItem = {
  id: string;
  entity_type: string;
  name: string;
  city?: string | null;
  city_id?: string | null;
  parent_name?: string | null;
  canonical_url?: string | null;
  score?: number | null;
  popularity_score?: number | null;
};

type AutocompleteResponse =
  | {
      query?: string;
      normalized_query?: string;
      groups?: Record<string, SuggestItem[]>;
      items?: SuggestItem[];
      suggestions?: SuggestItem[];
    }
  | any;

function pickSuggestions(data: AutocompleteResponse): SuggestItem[] {
  if (!data) return [];
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.suggestions)) return data.suggestions;
  if (data.groups && typeof data.groups === "object") {
    const all: SuggestItem[] = [];
    for (const k of Object.keys(data.groups)) {
      const arr = data.groups[k];
      if (Array.isArray(arr)) all.push(...arr);
    }
    return all;
  }
  return [];
}

async function fetchJson(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  let json: any = null;
  try {
    json = await res.json();
  } catch {}
  return { ok: res.ok, status: res.status, json };
}

export default function DisambiguatePage() {
  const sp = useSearchParams();

  const apiBase = useMemo(() => {
    return process.env.NEXT_PUBLIC_API_V1_BASE || "http://localhost:8000/api/v1";
  }, []);

  const q = (sp.get("q") || "").trim();
  const contextUrl = sp.get("context_url") || "/";
  const cityId = sp.get("city_id");

  const [candidates, setCandidates] = useState<SuggestItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      setErr(null);

      // 1) Try sessionStorage first (written by SearchBar when resolve returns candidates)
      try {
        const raw = sessionStorage.getItem("__disambiguate_candidates_v1");
        if (raw) {
          sessionStorage.removeItem("__disambiguate_candidates_v1");
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            if (mounted) setCandidates(parsed as SuggestItem[]);
            return;
          }
        }
      } catch {
        // ignore
      }

      // 2) Fallback to backend suggest/autocomplete
      if (!q) {
        if (mounted) setCandidates([]);
        return;
      }

      const params: Record<string, string> = { q, limit: "20" };
      if (cityId) params.city_id = cityId;

      const tryPaths = ["/search/suggest", "/search/autocomplete"];
      for (const path of tryPaths) {
        const usp = new URLSearchParams(params);
        const url = `${apiBase}${path}?${usp.toString()}`;

        const { ok, status, json } = await fetchJson(url);

        if (!mounted) return;

        if (ok) {
          setCandidates(pickSuggestions(json));
          return;
        }

        if (status !== 404) {
          setErr(`GET ${path} failed: ${status}`);
          setCandidates([]);
          return;
        }
      }

      setErr("GET /search/suggest failed: 404");
      setCandidates([]);
    })();

    return () => {
      mounted = false;
    };
  }, [apiBase, q, cityId]);

  const serpHref = useMemo(() => {
    const usp = new URLSearchParams();
    usp.set("q", q);
    usp.set("context_url", contextUrl);
    if (cityId) usp.set("city_id", cityId);
    return `/search?${usp.toString()}`;
  }, [q, contextUrl, cityId]);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto", color: "#fff" }}>
      <h1 style={{ marginBottom: 8 }}>Disambiguate</h1>
      <div style={{ opacity: 0.85, marginBottom: 16 }}>
        Query: <b>{q || "(empty)"}</b> · context: <b>{contextUrl}</b>
        {cityId ? <> · city_id: <b>{cityId}</b></> : null}
      </div>

      {err ? (
        <div style={{ color: "#ff6b6b", marginBottom: 12 }}>{err}</div>
      ) : null}

      <div style={{ marginBottom: 16 }}>
        <Link href={serpHref} style={{ textDecoration: "underline", color: "rgba(255,255,255,0.9)" }}>
          Go to SERP instead
        </Link>
      </div>

      {candidates.length === 0 ? (
        <div style={{ opacity: 0.8 }}>No candidates found.</div>
      ) : (
        <div style={{ display: "grid", gap: 10, maxWidth: 820 }}>
          {candidates.map((c, idx) => {
            const href = c.canonical_url ? `/go?url=${encodeURIComponent(c.canonical_url)}` : serpHref;
            return (
              <Link
                key={`${c.id}-${idx}`}
                href={href}
                style={{
                  display: "block",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 10,
                  padding: 12,
                  background: "rgba(0,0,0,0.25)",
                  color: "white",
                }}
              >
                <div style={{ fontSize: 14 }}>
                  <b>{c.name}</b>
                  {c.parent_name ? <span style={{ opacity: 0.75 }}> · {c.parent_name}</span> : null}
                  {c.city ? <span style={{ opacity: 0.75 }}> · {c.city}</span> : null}
                </div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  {c.entity_type}
                  {c.canonical_url ? <> · {c.canonical_url}</> : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}