import "./global.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Real Estate Search (Local)",
  description: "Autocomplete + typo correction + resolve + SERP (Elastic-backed).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
