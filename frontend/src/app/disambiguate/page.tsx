"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";

type EntityOut = {
  id: string;
  entity_type: string;
  name: string;
  city?: string | null;
  city_id?: string | null;
  parent_name?: string | null;
  canonical_url: string;
  score?: number | null;
  popularity_score?: number | null;
};

type ResolveResponse = {
  action: "redirect" | "serp" | "disambiguate";
  query: string;
  normalized_query: string;
  url: string | null;
  candidates?: EntityOut[] | null;
  reason?: string | null;
  debug?: any;
};

function sp1(v: string | null): string {
  return v ?? "";
}

function ensureLeadingSlash(u: string): string {
  if (!u) return "/";
  return u.startsWith("/") ? u : `/${u}`;
}

export default function DisambiguatePage() {
  const router = useRouter();
  const sp = useSearchParams();

  const q = sp1(sp.get("q"));
  const qid = sp1(sp.get("qid"));
  const city_id_param = sp1(sp.get("city_id")) || null;
  const context_url = sp1(sp.get("context_url")) || "/";

  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<EntityOut[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const title = useMemo(() => {
    if (!q) return "Choose one";
    return `Which “${q}” did you mean?`;
  }, [q]);

  useEffect(() => {
    async function run() {
      setLoading(true);
      setErr(null);
      try {
        const path =
          `/search/resolve?q=${encodeURIComponent(q)}` +
          (city_id_param ? `&city_id=${encodeURIComponent(city_id_param)}` : "") +
          `&context_url=${encodeURIComponent(context_url)}`;
        const res = await apiGet<ResolveResponse>(path);

        if (res.action === "redirect" && res.url) {
          router.replace(ensureLeadingSlash(res.url));
          return;
        }

        setCandidates(res.candidates || []);
      } catch (e: any) {
        setErr(e?.message || "Failed to load disambiguation options");
      } finally {
        setLoading(false);
      }
    }

    if (!q) {
      setLoading(false);
      setCandidates([]);
      return;
    }

    run();
  }, [q, city_id_param, context_url, router]);

  async function onPick(it: EntityOut, idx: number) {
    // CLICK LOG MUST include city_id: prefer entity city_id > page city_id
    const city_id = (it.city_id || city_id_param || null) as string | null;

    if (qid) {
      await apiPost("/events/click", {
        query_id: qid,
        entity_id: it.id,
        entity_type: it.entity_type,
        rank: idx + 1,
        url: ensureLeadingSlash(it.canonical_url),
        city_id,
        context_url,
        timestamp: new Date().toISOString(),
      });
    }

    router.push(ensureLeadingSlash(it.canonical_url));
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-gray-600">
        Select the correct location/project to continue.
      </p>

      {loading && <div className="mt-6 text-sm text-gray-600">Loading…</div>}

      {!loading && err && (
        <div className="mt-6 rounded-lg border bg-red-50 px-4 py-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {!loading && !err && candidates.length === 0 && (
        <div className="mt-6 rounded-lg border bg-gray-50 px-4 py-3 text-sm text-gray-700">
          No disambiguation options found. Try searching again.
        </div>
      )}

      {!loading && !err && candidates.length > 0 && (
        <div className="mt-6 space-y-2">
          {candidates.map((it, idx) => (
            <button
              key={`${it.id}_${idx}`}
              onClick={() => void onPick(it, idx)}
              className="w-full rounded-xl border px-4 py-3 text-left hover:bg-gray-50"
              type="button"
            >
              <div className="font-medium">{it.name}</div>
              <div className="mt-0.5 text-xs text-gray-600">
                {it.city ? it.city : "—"}
                {it.parent_name ? ` • ${it.parent_name}` : ""}
              </div>
              <div className="mt-1 text-xs text-gray-400">{it.canonical_url}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}