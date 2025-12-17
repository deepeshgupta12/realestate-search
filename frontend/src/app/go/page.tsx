// frontend/src/app/go/page.tsx
import { redirect } from "next/navigation";
import { buildUrl } from "@/lib/api";

type ResolveResponse = {
  action: "redirect" | "serp" | "disambiguate";
  query: string;
  normalized_query: string;
  url: string | null;
  match: any | null;
  candidates: any[] | null;
  reason: string | null;
  debug: any | null;
};

type PageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function sp1(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export default async function GoPage({ searchParams }: PageProps) {
  const q = sp1(searchParams?.q);
  const city_id = sp1(searchParams?.city_id);
  const context_url = sp1(searchParams?.context_url) || "/";

  // Optional but recommended: qid for click logging attribution
  const qid = sp1(searchParams?.qid);

  if (!q || !q.trim()) {
    redirect("/");
  }

  const resolveUrl = buildUrl("/search/resolve", {
    q,
    city_id: city_id || undefined,
    context_url: context_url || undefined,
  });

  const res = await fetch(resolveUrl, { cache: "no-store" });
  if (!res.ok) {
    // If backend is down, fail safe to SERP
    redirect(`/search?q=${encodeURIComponent(q)}`);
  }

  const data = (await res.json()) as ResolveResponse;

  // If backend gives a URL, trust it
  if (data.action === "redirect" && data.url) {
    redirect(data.url);
  }

  if (data.action === "serp") {
    if (data.url) redirect(data.url);
    redirect(`/search?q=${encodeURIComponent(q)}${city_id ? `&city_id=${encodeURIComponent(city_id)}` : ""}`);
  }

  // disambiguate
  const disUrl =
    `/disambiguate?q=${encodeURIComponent(q)}` +
    (qid ? `&qid=${encodeURIComponent(qid)}` : "") +
    (city_id ? `&city_id=${encodeURIComponent(city_id)}` : "") +
    (context_url ? `&context_url=${encodeURIComponent(context_url)}` : "");

  redirect(disUrl);
}