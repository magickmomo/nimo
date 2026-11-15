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
        <main>{children}</main>
      </body>
    </html>
  );
}
