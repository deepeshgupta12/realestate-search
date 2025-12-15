import Link from "next/link";
import { redirect } from "next/navigation";
import { apiGet } from "@/lib/api";
import type { ResolveResponse } from "@/lib/types";

export default async function DisambiguatePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    city_id?: string;
    qid?: string;
    context_url?: string;
  }>;
}) {
  const sp = await searchParams;

  const q = (sp.q || "").trim();
  const city_id = (sp.city_id || "").trim() || undefined;
  const qid = (sp.qid || "").trim() || undefined;
  const context_url = (sp.context_url || "").trim() || undefined;

  if (!q) redirect("/");

  const res = await apiGet<ResolveResponse>("/api/v1/search/resolve", {
    q,
    city_id,
  });

  // If backend decides it is not disambiguation anymore, follow it.
  if (res.action === "redirect" && res.url) redirect(res.url);
  if (res.action === "serp" && res.url) redirect(res.url);

  const candidates = res.candidates || [];
  if (!candidates.length) {
    // Fallback: go to SERP if backend returned no candidates unexpectedly
    const fallback = `/search?q=${encodeURIComponent(q)}${
      city_id ? `&city_id=${encodeURIComponent(city_id)}` : ""
    }`;
    redirect(fallback);
  }

  return (
    <main className="container">
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 18, margin: 0 }}>Which “{q}” did you mean?</h1>
            <p className="muted" style={{ marginTop: 6 }}>
              Multiple places/entities share the same name. Pick one to continue.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link
              className="link"
              href={`/search?q=${encodeURIComponent(q)}${
                city_id ? `&city_id=${encodeURIComponent(city_id)}` : ""
              }`}
            >
              View all results
            </Link>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          {candidates.map((c, idx) => {
            const goHref =
              `/go?url=${encodeURIComponent(c.canonical_url)}` +
              (qid ? `&qid=${encodeURIComponent(qid)}` : "") +
              `&entity_id=${encodeURIComponent(c.id)}` +
              `&entity_type=${encodeURIComponent(c.entity_type)}` +
              `&rank=${idx + 1}` +
              (c.city_id ? `&city_id=${encodeURIComponent(c.city_id)}` : "") +
              (context_url ? `&context_url=${encodeURIComponent(context_url)}` : "");

            return (
              <Link key={c.id} href={goHref} className="resultCard">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    <div className="meta">
                      {c.entity_type}
                      {" • "}
                      {(c.city || c.city_id || "Unknown city") + (c.parent_name ? ` • ${c.parent_name}` : "")}
                    </div>
                  </div>

                  <div className="pill">
                    {c.city || (c.city_id ? c.city_id.replace("city_", "").toUpperCase() : "CITY")}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        <div style={{ marginTop: 12 }} className="meta">
          Tip: if you usually search within a city, pass <code>city_id</code> for cleaner disambiguation.
        </div>
      </div>
    </main>
  );
}
