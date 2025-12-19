import Link from "next/link";

type PageProps = {
  params: Promise<{ city: string }>;
};

export default async function CityHomePage({ params }: PageProps) {
  const { city } = await params;

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto" }}>
      <h1 style={{ marginBottom: 8 }}>City Page (v1 demo)</h1>

      <p style={{ marginTop: 0 }}>
        Dynamic city route for <b>/{city}</b>.
      </p>

      <div style={{ marginTop: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Link href={`/${city}/buy`}>Go to /{city}/buy</Link>
        <Link href={`/${city}/rent`}>Go to /{city}/rent</Link>
        <Link href={`/search?q=${encodeURIComponent(city)}&context_url=/${encodeURIComponent(city)}`}>
          Go to SERP (city context)
        </Link>
      </div>
    </main>
  );
}