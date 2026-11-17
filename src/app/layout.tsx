import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = { title: "UpRank · Client dashboard", description: "Client priorities, retention, leads, revenue and advertising metrics." };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en-AU"><body>{children}</body></html>;
}
