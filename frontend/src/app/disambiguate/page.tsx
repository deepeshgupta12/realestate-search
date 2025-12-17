import React from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";

type SearchParams = Record<string, string | string[] | undefined>;
type PageProps = { searchParams: Promise<SearchParams> };

function sp1(v: string | string[] | undefined): string | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

type EntityOut = {
  id: string;
  entity_type: string;
  name: string;
  city?: string;
  city_id?: string;
  parent_name?: string;
  canonical_url: string;
  score?: number | null;
  popularity_score?: number | null;
};

type ResolveResponse = {
  action: "redirect" | "disambiguate" | "serp";
  query: string;
  normalized_query: string;
  url?: string | null;
  candidates?: EntityOut[] | null;
  reason?: string | null;
  debug?: any;
};

export default async function DisambiguatePage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const q = sp1(sp.q) || "";
  const qid = sp1(sp.qid) || "";
  const context_url = sp1(sp.context_url) || "/";

  const data = await apiGet<ResolveResponse>("/api/v1/search/resolve", {
    q,
  });

  const candidates = data.candidates || [];

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold">Which “{q}” did you mean?</h1>
      <p className="mt-2 text-sm text-gray-600">
        Pick the correct location/project. We’ll apply your full query (like BHK/budget) after you choose.
      </p>

      <div className="mt-6 space-y-3">
        {candidates.map((c, idx) => {
          const cityId = c.city_id || "";
          const hrefParams = new URLSearchParams();

          // IMPORTANT: route via /go with q + selected city_id so backend can build filtered listing URL
          hrefParams.set("q", q);
          if (cityId) hrefParams.set("city_id", cityId);
          hrefParams.set("context_url", context_url);

          // keep qid for events/search correlation (if present)
          if (qid) hrefParams.set("qid", qid);

          // pass entity metadata so /go can log click against final resolved URL
          hrefParams.set("eid", c.id);
          hrefParams.set("etype", c.entity_type);
          hrefParams.set("rank", String(idx + 1));

          const href = `/go?${hrefParams.toString()}`;

          return (
            <Link
              key={c.id}
              href={href}
              className="block rounded-lg border border-gray-200 p-4 hover:bg-gray-50"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="mt-1 text-sm text-gray-600">
                    {(c.city || "") && <span>{c.city}</span>}
                    {(c.parent_name || "") && <span> • {c.parent_name}</span>}
                    <span className="ml-2 rounded bg-gray-100 px-2 py-0.5 text-xs">
                      {c.entity_type}
                    </span>
                  </div>
                </div>
                <div className="text-sm text-gray-500">{c.canonical_url}</div>
              </div>
            </Link>
          );
        })}
      </div>

      {candidates.length === 0 && (
        <div className="mt-8 rounded-lg border border-gray-200 p-4 text-sm text-gray-700">
          No candidates found. Try a different query.
        </div>
      )}
    </main>
  );
}