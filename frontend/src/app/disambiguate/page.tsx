import Link from "next/link";
import { redirect } from "next/navigation";
import { apiGet } from "@/lib/api";
import type { ResolveResponse } from "@/lib/types";

type SP = {
  q?: string;
  city_id?: string;
  qid?: string;
  context_url?: string;
};

function buildGoHref(args: {
  url: string;
  qid?: string;
  entity_id?: string;
  entity_type?: string;
  rank?: number;
  city_id?: string;
  context_url?: string;
}) {
  const p = new URLSearchParams();
  p.set("url", args.url);
  if (args.qid) p.set("qid", args.qid);
  if (args.entity_id) p.set("entity_id", args.entity_id);
  if (args.entity_type) p.set("entity_type", args.entity_type);
  if (typeof args.rank === "number") p.set("rank", String(args.rank));
  if (args.city_id) p.set("city_id", args.city_id);
  if (args.context_url) p.set("context_url", args.context_url);
  return `/go?${p.toString()}`;
}

export default async function DisambiguatePage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;

  const q = (sp.q || "").trim();
  const city_id = (sp.city_id || "").trim() || undefined;
  const qid = (sp.qid || "").trim() || undefined;
  const context_url = (sp.context_url || "").trim() || "/";

  if (!q) {
    return (
      <main style={{ padding: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Choose a result</h1>
        <p style={{ marginTop: 8 }}>Missing query.</p>
        <p style={{ marginTop: 8 }}>
          <Link href="/">Go back</Link>
        </p>
      </main>
    );
  }

  const res = await apiGet<ResolveResponse>("/search/resolve", { q, city_id });

  if (res.action === "redirect" && res.url) redirect(res.url);
  if (res.action === "serp" && res.url) redirect(res.url);

  const candidates = res.candidates || [];

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Which “{q}” did you mean?</h1>
      <p style={{ marginTop: 6, opacity: 0.8 }}>
        Multiple matches found. Pick one to continue.
      </p>

      {candidates.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <p>No candidates returned.</p>
          <p style={{ marginTop: 8 }}>
            <Link href={`/search?q=${encodeURIComponent(q)}`}>See all results</Link>
          </p>
        </div>
      ) : (
        <ul style={{ marginTop: 16, paddingLeft: 18 }}>
          {candidates.map((c, idx) => (
            <li key={c.id} style={{ marginBottom: 10 }}>
              <Link
                href={buildGoHref({
                  url: c.canonical_url,
                  qid,
                  entity_id: c.id,
                  entity_type: c.entity_type,
                  rank: idx + 1,
                  city_id,
                  context_url,
                })}
                style={{ textDecoration: "underline" }}
              >
                {c.name}
              </Link>
              <span style={{ marginLeft: 8, opacity: 0.8 }}>
                — {c.city}
                {c.parent_name ? ` · ${c.parent_name}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: 18 }}>
        <Link href={`/search?q=${encodeURIComponent(q)}`}>See all results</Link>
      </div>
    </main>
  );
}
