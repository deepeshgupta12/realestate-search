"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";

export default function GoPage() {
  const sp = useSearchParams();
  const url = sp.get("url") || "/";
  const q = sp.get("q") || "";

  return (
    <main style={{ padding: "40px 20px", display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 900 }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Redirect (Demo)</h1>
        <p style={{ color: "#666" }}>
          Query <b>{q}</b> resolved to:
        </p>
        <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 10 }}>
          <code style={{ fontSize: 14 }}>{url}</code>
        </div>
        <div style={{ marginTop: 16 }}>
          <Link href="/" style={{ color: "#0b57d0" }}>Back to Home</Link>
        </div>
      </div>
    </main>
  );
}
