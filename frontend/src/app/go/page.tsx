// frontend/src/app/go/page.tsx
import { redirect } from "next/navigation";
import { buildUrl } from "@/lib/api";

export const dynamic = "force-dynamic";

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

type SP = Record<string, string | string[] | undefined>;

type PageProps = {
  // In some Next versions this is an object, in others it can be a Promise.
  searchParams?: SP | Promise<SP>;
};

function sp1(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export default async function GoPage({ searchParams }: PageProps) {
  // ✅ Works whether searchParams is an object or a Promise
  const sp: SP = await Promise.resolve(searchParams ?? {});

  const q = sp1(sp.q);
  const city_id = sp1(sp.city_id);
  const context_url = sp1(sp.context_url) || "/";
  const qid = sp1(sp.qid);

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
    redirect(`/search?q=${encodeURIComponent(q)}`);
  }

  const data = (await res.json()) as ResolveResponse;

  if (data.action === "redirect" && data.url) {
    redirect(data.url);
  }

  if (data.action === "serp") {
    if (data.url) redirect(data.url);
    redirect(
      `/search?q=${encodeURIComponent(q)}${
        city_id ? `&city_id=${encodeURIComponent(city_id)}` : ""
      }`
    );
  }

  // disambiguate
  const disUrl =
    `/disambiguate?q=${encodeURIComponent(q)}` +
    (qid ? `&qid=${encodeURIComponent(qid)}` : "") +
    (city_id ? `&city_id=${encodeURIComponent(city_id)}` : "") +
    (context_url ? `&context_url=${encodeURIComponent(context_url)}` : "");

  redirect(disUrl);
}