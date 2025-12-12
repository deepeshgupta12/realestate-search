import SearchBar from "@/components/SearchBar";

export default function HomePage() {
  return (
    <main className="page">
      <h1 className="h1">Real Estate Search (Local)</h1>
      <p className="sub">Autocomplete + typo correction + resolve + SERP (Elastic-backed).</p>

      <SearchBar />

      <div className="serpMeta">
        Tip: try <strong>Baner</strong>, <strong>Godrej wods</strong>, or <strong>zzzzzz</strong>.
      </div>
    </main>
  );
}