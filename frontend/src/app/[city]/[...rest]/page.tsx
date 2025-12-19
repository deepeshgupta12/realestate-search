import Link from "next/link";

type PageProps = {
  params: Promise<{ city: string; rest?: string[] }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function pickIntent(rest: string[]) {
  const idx = rest.findIndex((s) => s === "buy" || s === "rent");
  if (idx === -1) return { intent: null as null | "buy" | "rent", place: null as null | string };
  const intent = rest[idx] as "buy" | "rent";
  const place = idx > 0 ? rest.slice(0, idx).join("/") : null;
  return { intent, place };
}

export default async function CityCatchAllPage({ params, searchParams }: PageProps) {
  const p = await params;
  const sp = searchParams ? await searchParams : {};

  const city = p.city;
  const rest = p.rest ?? [];
  const { intent, place } = pickIntent(rest);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto" }}>
      <h1 style={{ marginBottom: 8 }}>Dynamic Listing Route (v1 demo)</h1>

      <div style={{ marginTop: 16 }}>
        <div><b>city</b>: {city}</div>
        <div><b>rest</b>: {JSON.stringify(rest)}</div>
        <div><b>intent</b>: {intent ?? "unknown"}</div>
        <div><b>place</b>: {place ?? "none"}</div>
      </div>

      <h2 style={{ marginTop: 24, marginBottom: 8 }}>Query Params</h2>
      <pre style={{ background: "#111", color: "#ddd", padding: 12, borderRadius: 8, overflow: "auto" }}>
        {JSON.stringify(sp ?? {}, null, 2)}
      </pre>

      <div style={{ marginTop: 20 }}>
        <Link
          href={`/search?q=${encodeURIComponent(place ? place.replaceAll("/", " ") : city)}&context_url=/${encodeURIComponent(city)}`}
        >
          Go to SERP for this context
        </Link>
      </div>
    </main>
  );
}