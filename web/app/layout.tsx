import type { Metadata } from "next";
import "./style.css";

export const metadata: Metadata = {
  title: "Nimo’s World",
  description: "Explore Nimo’s autonomous world.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <a className="brand" href="/" aria-label="Nimo home">nimo.</a>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
