import SearchBar from "@/components/SearchBar";

export default function HomePage() {
  return (
    <main className="container">
      <h1 className="title">Real Estate Search (Local)</h1>
      <p className="sub">Autocomplete + typo correction + resolve + SERP (Elastic-backed).</p>

      <SearchBar />

      <div className="serpMeta">
        Tip: try <strong>Baner</strong>, <strong>Godrej woods</strong>, or <strong>zzzzzz</strong>.
      </div>
    </main>
  );
}