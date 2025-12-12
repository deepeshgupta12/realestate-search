import Link from "next/link";

// frontend/src/app/go/page.tsx
function isPromise<T>(v: unknown): v is Promise<T> {
  return !!v && typeof v === "object" && "then" in v && typeof (v as any).then === "function";
}

export default async function GoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; url?: string }> | { q?: string; url?: string };
}) {
  const sp = isPromise<{ q?: string; url?: string }>(searchParams) ? await searchParams : searchParams;

  const q = (sp.q || "").trim();
  const url = (sp.url || "").trim();

  return (
    <main className="min-h-screen bg-[#0b0c0f] text-white">
      <div className="max-w-3xl mx-auto px-6 pt-20">
        <h1 className="text-3xl font-semibold">Redirect (Demo)</h1>
        <p className="mt-2 opacity-70">
          Query <span className="font-semibold">{q}</span> resolved to:
        </p>

        <div className="mt-6 border border-white/15 rounded-lg p-4 bg-white/5">
          <div className="font-mono">{url || "(missing url)"}</div>
        </div>

        <Link className="inline-block mt-6 underline opacity-80" href="/">
          Back to Home
        </Link>
      </div>
    </main>
  );
}