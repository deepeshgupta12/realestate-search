import { redirect } from "next/navigation";

type SP = {
  url?: string;
  qid?: string;
  entity_id?: string;
  entity_type?: string;
  rank?: string;
  city_id?: string;
  context_url?: string;
};

function normalizeApiBase(raw?: string) {
  const base = (raw || "http://localhost:8000").replace(/\/+$/, "");
  // accept either:
  // - http://localhost:8000
  // - http://localhost:8000/api/v1
  if (base.endsWith("/api/v1")) return base;
  return `${base}/api/v1`;
}

async function postJson(url: string, body: any) {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    // best-effort logging; never block navigation
  }
}

export default async function GoPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;

  const url = (sp.url || "").trim();
  if (!url) redirect("/");

  const qid = (sp.qid || "").trim() || null;
  const entity_id = (sp.entity_id || "").trim() || null;
  const entity_type = (sp.entity_type || "").trim() || null;

  const rank = sp.rank ? Number(sp.rank) : null;
  const city_id = (sp.city_id || "").trim() || null;
  const context_url = (sp.context_url || "").trim() || null;

  const apiBase = normalizeApiBase(process.env.NEXT_PUBLIC_API_BASE);

  await postJson(`${apiBase}/events/click`, {
    query_id: qid,
    entity_id,
    entity_type,
    rank,
    url,
    city_id,
    context_url,
    timestamp: new Date().toISOString(),
  });

  redirect(url);
}
