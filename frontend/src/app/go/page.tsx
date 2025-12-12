import Link from "next/link";

export default async function GoPage({ searchParams }: { searchParams: any }) {
  const sp = await Promise.resolve(searchParams);
  const url = String(sp?.url || "").trim();
  const q = String(sp?.q || "").trim();

  return (
    <main className="page">
      <h1 className="h1">Redirect (Demo)</h1>
      <p className="sub">Query <strong>{q || "—"}</strong> resolved to:</p>

      <div className="card">
        <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
          {url || "(missing url)"}
        </div>
        <div className="hr" />
        <Link className="link" href="/">Back to Home</Link>
      </div>
    </main>
  );
}