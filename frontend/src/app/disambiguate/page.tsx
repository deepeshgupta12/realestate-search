import Link from "next/link";
import { redirect } from "next/navigation";

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
  action: "redirect" | "serp" | "disambiguate";
  query: string;
  normalized_query: string;
  url?: string | null;
  match?: EntityOut | null;
  candidates?: EntityOut[] | null;
  reason?: string | null;
  debug?: Record<string, any> | null;
};

const API_BASE =
  (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/+$/, "");

function goUrl(params: {
  url: string;
  qid?: string | null;
  entity_id?: string | null;
  entity_type?: string | null;
  rank?: number | null;
  city_id?: string | null;
  context_url?: string | null;
}) {
  const sp = new URLSearchParams();
  sp.set("url", params.url);
  if (params.qid) sp.set("qid", params.qid);
  if (params.entity_id) sp.set("entity_id", params.entity_id);
  if (params.entity_type) sp.set("entity_type", params.entity_type);
  if (typeof params.rank === "number") sp.set("rank", String(params.rank));
  if (params.city_id) sp.set("city_id", params.city_id);
  if (params.context_url) sp.set("context_url", params.context_url);
  return `/go?${sp.toString()}`;
}

export default async function DisambiguatePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; qid?: string; city_id?: string; context_url?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q || "").trim();
  const qid = (sp.qid || "").trim();
  const cityId = (sp.city_id || "").trim();
  const contextUrl = (sp.context_url || "").trim();

  if (!q) {
    redirect("/");
  }

  const url =
    `${API_BASE}/api/v1/search/resolve?q=${encodeURIComponent(q)}` +
    (cityId ? `&city_id=${encodeURIComponent(cityId)}` : "") +
    (contextUrl ? `&context_url=${encodeURIComponent(contextUrl)}` : "");

  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold">Choose one</h1>
        <p className="mt-2 opacity-70">Resolve API failed ({r.status}).</p>
      </main>
    );
  }

  const data = (await r.json()) as ResolveResponse;

  // If user landed here but backend no longer wants disambiguation, route correctly
  if (data.action === "redirect" && data.url) {
    const m = data.match || null;
    redirect(
      goUrl({
        url: data.url,
        qid: qid || null,
        entity_id: m?.id || null,
        entity_type: m?.entity_type || null,
        rank: 1,
        city_id: cityId || null,
        context_url: contextUrl || null,
      })
    );
  }

  if (data.action === "serp" && data.url) {
    redirect(data.url);
  }

  const candidates = data.candidates || [];

  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">Choose one</h1>
      <div className="mt-2 text-sm opacity-80">
        Query: <span className="font-medium">{q}</span>
      </div>

      {candidates.length === 0 ? (
        <div className="mt-6 rounded border p-4">
          <div className="font-medium">No candidates returned.</div>
          <div className="mt-1 text-sm opacity-70">
            Try{" "}
            <Link className="underline" href={`/search?q=${encodeURIComponent(q)}${cityId ? `&city_id=${encodeURIComponent(cityId)}` : ""}`}>
              Search results
            </Link>
            .
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded border divide-y">
          {candidates.map((c, idx) => {
            const subtitle = [c.parent_name, c.city].filter(Boolean).join(" • ");
            return (
              <Link
                key={c.id}
                className="block px-4 py-3 hover:bg-black/5"
                href={goUrl({
                  url: c.canonical_url,
                  qid: qid || null,
                  entity_id: c.id,
                  entity_type: c.entity_type,
                  rank: idx + 1,
                  city_id: cityId || null,
                  context_url: contextUrl || null,
                })}
              >
                <div className="font-medium text-sm">{c.name}</div>
                <div className="text-xs opacity-70">{subtitle}</div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}