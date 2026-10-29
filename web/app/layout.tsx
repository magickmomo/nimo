import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = { title: "Nimo", description: "Nimo companion and art studio" };
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><body><header><a className="brand" href="/">nimo.</a><nav><a href="/">Home</a><a href="/companion">Companion</a><a href="/studio">Art studio</a><a href="/poetry">Poetry</a></nav></header><main>{children}</main><footer>Nimo · learning to explore the world</footer></body></html>}
