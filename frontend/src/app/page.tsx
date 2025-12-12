import SearchBar from "@/components/SearchBar";

export default function Home() {
  return (
    <main style={{ padding: "48px 20px", display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 900 }}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Real Estate Search (Local)</h1>
        <p style={{ color: "#666", marginTop: 0, marginBottom: 24 }}>
          Autocomplete + typo correction + resolve + SERP (Elastic-backed).
        </p>
        <SearchBar />
        <div style={{ marginTop: 24, color: "#666", fontSize: 14 }}>
          Try: <b>baner</b>, <b>godrej wods</b>, <b>dlf</b>, <b>zzzzzz</b>
        </div>
      </div>
    </main>
  );
}
