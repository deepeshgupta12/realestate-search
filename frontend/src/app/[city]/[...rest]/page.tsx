import Link from "next/link";

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  params: Promise<{ city: string; rest?: string[] }>;
  searchParams?: Promise<SearchParams>;
};

function pickIntent(rest?: string[]) {
  const parts = Array.isArray(rest) ? rest : [];
  const idx = parts.findIndex((s) => s === "buy" || s === "rent");
  if (idx === -1) return { intent: null as null | "buy" | "rent", place: null as null | string };

  const intent = parts[idx] as "buy" | "rent";
  const place = idx > 0 ? parts.slice(0, idx).join("/") : null;
  return { intent, place };
}

export default async function CityCatchAllPage({ params, searchParams }: PageProps) {
  const { city, rest } = await params;
  const sp = (searchParams ? await searchParams : {}) as SearchParams;

  const { intent, place } = pickIntent(rest);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto" }}>
      <h1 style={{ marginBottom: 8 }}>Listing Route (v1 demo)</h1>

      <div style={{ marginTop: 8 }}>
        <div>
          <b>city:</b> {city}
        </div>
        <div>
          <b>intent:</b> {intent ?? "(none)"}
        </div>
        <div>
          <b>place:</b> {place ?? "(city-wide)"}
        </div>
        <div>
          <b>query:</b> {JSON.stringify(sp ?? {})}
        </div>
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Link href={`/search?q=${encodeURIComponent(city)}&context_url=/${encodeURIComponent(city)}`}>
          Go to SERP (city context)
        </Link>
      </div>
    </main>
  );
}