import Link from "next/link";

type SearchParamsShape = { url?: string; q?: string };
type Props = { searchParams: Promise<SearchParamsShape> | SearchParamsShape };

export default async function GoPage({ searchParams }: Props) {
  const sp = await Promise.resolve(searchParams as SearchParamsShape);
  const url = (sp?.url ?? "").trim();
  const q = (sp?.q ?? "").trim();

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "48px 20px" }}>
      <h1 style={{ marginBottom: 8 }}>Redirect (Demo)</h1>

      {q ? (
        <div style={{ opacity: 0.75, marginBottom: 18 }}>
          Query <b>{q}</b> resolved to:
        </div>
      ) : null}

      {url ? (
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 10,
            padding: 14,
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            {url}
          </div>
        </div>
      ) : (
        <div style={{ opacity: 0.75 }}>
          Missing <code>url</code> param.
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <Link href="/">Back to Home</Link>
      </div>
    </main>
  );
}
