type PageProps = {
  params: Promise<{ city: string; rest: string[] }>;
  searchParams?: Record<string, string | string[] | undefined>;
};

function pickIntent(rest: unknown) {
  const arr = Array.isArray(rest) ? rest : [];
  const idx = arr.findIndex((s) => s === "buy" || s === "rent");
  if (idx === -1) return { intent: null as null | "buy" | "rent", place: arr.join("/") || null };

  const intent = arr[idx] as "buy" | "rent";
  const place = idx > 0 ? arr.slice(0, idx).join("/") : null;
  return { intent, place };
}

export default async function CityCatchAllPage({ params, searchParams }: PageProps) {
  const { city, rest } = await params;
  const { intent, place } = pickIntent(rest);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto" }}>
      <h1 style={{ marginBottom: 8 }}>Listing Route (v1 demo)</h1>

      <div style={{ marginTop: 8 }}>
        <div><b>city:</b> {city}</div>
        <div><b>intent:</b> {intent ?? "(none)"}</div>
        <div><b>place:</b> {place ?? "(city-wide)"}</div>
        <div><b>query:</b> {JSON.stringify(searchParams ?? {})}</div>
      </div>
    </main>
  );
}