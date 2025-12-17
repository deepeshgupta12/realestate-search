// frontend/src/app/go/page.tsx
import { redirect } from "next/navigation";

type SP = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function apiBase(): string {
  return (
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    "http://127.0.0.1:8000"
  );
}

async function postClick(payload: Record<string, any>) {
  const url = new URL("/api/v1/events/click", apiBase()).toString();
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(payload),
    });
  } catch {
    // do not block navigation on logging failures
  }
}

export default async function GoPage({
  searchParams,
}: {
  searchParams: SP | Promise<SP>;
}) {
  const sp: SP =
    typeof (searchParams as Promise<SP>)?.then === "function"
      ? await (searchParams as Promise<SP>)
      : (searchParams as SP);

  const url = first(sp.url);
  const qid = first(sp.qid);
  const entity_id = first(sp.entity_id);
  const entity_type = first(sp.entity_type);
  const rankRaw = first(sp.rank);

  const city_id = first(sp.city_id) || null;
  const context_url = first(sp.context_url) || null;

  if (!url) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Invalid redirect</h1>
        <p>Missing url param.</p>
      </main>
    );
  }

  const payload: Record<string, any> = {
    query_id: qid || null,
    entity_id: entity_id || null,
    entity_type: entity_type || null,
    rank: rankRaw ? Number(rankRaw) : null,
    url,
    city_id,
    context_url,
    timestamp: new Date().toISOString(),
  };

  await postClick(payload);

  // internal navigation (e.g. /pune/baner)
  redirect(url);
}