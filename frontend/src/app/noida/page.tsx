import SearchBar from "@/components/SearchBar";

export default function NoidaDemoPage() {
  return (
    <main className="container">
      <h1 className="title">Noida demo</h1>
      <p className="sub">Zero-state should prefer city_noida entities first (then global).</p>

      <SearchBar contextUrl="/noida" defaultCityId="city_noida" />
    </main>
  );
}