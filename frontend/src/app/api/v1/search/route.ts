import { NextResponse } from "next/server";

const BACKEND_BASE =
  process.env.NEXT_PUBLIC_API_BASE ||
  process.env.API_BASE ||
  "http://localhost:8000";

export async function GET(req: Request) {
  const url = new URL(req.url);

  const upstream = new URL("/api/v1/search", BACKEND_BASE);
  upstream.search = url.search;

  const res = await fetch(upstream.toString(), { cache: "no-store" });
  const body = await res.text();

  return new NextResponse(body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
    },
  });
}