import SearchBar from "@/components/SearchBar";

export default function PuneDemoPage() {
  return (
    <main className="container">
      <h1 className="title">Pune demo</h1>
      <p className="sub">Zero-state should prefer city_pune entities first (then global).</p>

      <SearchBar contextUrl="/pune" defaultCityId="city_pune" />
    </main>
  );
}