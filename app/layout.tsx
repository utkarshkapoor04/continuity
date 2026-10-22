import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Continuity",
  description: "Find what the handover documents don't say.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
