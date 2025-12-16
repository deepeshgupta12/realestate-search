"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiGet } from "@/lib/api";
import type { ResolveResponse, EntityOut } from "@/lib/types";

export default function DisambiguatePage() {
  const router = useRouter();
  const sp = useSearchParams();

  const q = (sp.get("q") || "").trim();
  const qidParam = (sp.get("qid") || "").trim();
  const cityId = (sp.get("city_id") || "").trim() || undefined;
  const contextUrl = (sp.get("context_url") || "/").trim() || "/";

  const qid = useMemo(() => qidParam || (globalThis.crypto?.randomUUID?.() ?? `qid_${Date.now()}`), [qidParam]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resp, setResp] = useState<ResolveResponse | null>(null);

  useEffect(() => {
    let mounted = true;
    async function run() {
      if (!q) return;
      setLoading(true);
      setErr(null);
      try {
        const r = await apiGet<ResolveResponse>("/search/resolve", {
          q,
          city_id: cityId,
          context_url: contextUrl,
        });
        if (!mounted) return;
        setResp(r);

        // If backend doesn't return disambiguate, route accordingly
        if (r.action === "redirect" && r.url) {
          router.replace(`/go?url=${encodeURIComponent(r.url)}&qid=${encodeURIComponent(qid)}&context_url=${encodeURIComponent(contextUrl)}`);
          return;
        }
        if (r.action === "serp") {
          const url = r.url || `/search?q=${encodeURIComponent(q)}${cityId ? `&city_id=${encodeURIComponent(cityId)}` : ""}`;
          router.replace(`${url}${url.includes("?") ? "&" : "?"}qid=${encodeURIComponent(qid)}&context_url=${encodeURIComponent(contextUrl)}`);
          return;
        }
      } catch (e: any) {
        if (!mounted) return;
        setErr(e?.message || "Failed to resolve");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    run();
    return () => {
      mounted = false;
    };
  }, [q, cityId, contextUrl, qid, router]);

  const candidates: EntityOut[] = (resp?.action === "disambiguate" && resp.candidates) ? resp.candidates : [];

  function pick(c: EntityOut, rank: number) {
    const target = c.canonical_url;
    router.push(
      `/go?url=${encodeURIComponent(target)}&qid=${encodeURIComponent(qid)}&eid=${encodeURIComponent(c.id)}&etype=${encodeURIComponent(c.entity_type)}&rank=${encodeURIComponent(
        String(rank)
      )}&city_id=${encodeURIComponent(c.city_id || "")}&context_url=${encodeURIComponent(contextUrl)}`
    );
  }

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold">Which one did you mean?</h1>
        <div className="mt-2 text-sm opacity-70">
          Query: <span className="font-mono">{q || "(empty)"}</span>
        </div>

        {loading && <div className="mt-6 text-sm opacity-70">Loading…</div>}
        {err && <div className="mt-6 text-sm text-red-400">{err}</div>}

        {!loading && !err && resp?.action === "disambiguate" && (
          <div className="mt-6 space-y-3">
            {candidates.length === 0 ? (
              <div className="text-sm opacity-70">No candidates returned.</div>
            ) : (
              candidates.map((c, idx) => (
                <button
                  key={`${c.id}-${idx}`}
                  type="button"
                  onClick={() => pick(c, idx + 1)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left hover:bg-white/10"
                >
                  <div className="text-base font-medium">{c.name}</div>
                  <div className="mt-1 text-xs opacity-70">
                    <span className="font-mono">{c.entity_type}</span>
                    {c.city ? <span> · {c.city}</span> : null}
                    {c.parent_name ? <span> · {c.parent_name}</span> : null}
                  </div>
                  <div className="mt-2 text-xs opacity-60 font-mono">{c.canonical_url}</div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </main>
  );
}