// frontend/app/page.tsx
import SearchBox from "@/components/SearchBar";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#0b0c0f] text-white">
      <div className="max-w-5xl mx-auto px-6 pt-20">
        <h1 className="text-4xl font-semibold">Real Estate Search (Local)</h1>
        <p className="mt-2 opacity-70">Autocomplete + typo correction + resolve + SERP (Elastic-backed).</p>

        <div className="mt-10">
          <SearchBox />
        </div>
      </div>
    </main>
  );
}