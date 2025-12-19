import SearchBar from "@/components/SearchBar";

export default function PunePage() {
  return (
    <main className="min-h-screen bg-[#0b0b0d] text-white">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-semibold">Real Estate Search (Local)</h1>
        <p className="mt-3 text-sm text-white/70">
          City context page: <span className="font-medium">Pune</span>
        </p>

        <div className="mt-8">
          <SearchBar />
        </div>

        <div className="mt-6 text-xs text-white/60">
          Tip: search <span className="font-semibold">Baner</span> and observe city-scoped resolve + recents.
        </div>
      </div>
    </main>
  );
}