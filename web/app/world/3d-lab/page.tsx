import type { Metadata } from "next";
import Link from "next/link";
import ThreeLab from "./three-lab";
import "./three-lab.css";

export const metadata: Metadata = {
  title: "Nimo | 3D renderer lab",
  description: "Experimental Three.js view of Nimo's existing world. The 2D world stays unchanged.",
};

export default function ThreeLabPage() {
  return (
    <div className="nimo-three-lab">
      <div className="nimo-three-lab-bar">
        <div className="nimo-three-lab-title">
          <strong>3D renderer lab</strong>
          <span>Experimental view · shared world coordinates</span>
        </div>
        <Link href="/world" className="nimo-three-return">Back to 2D world</Link>
      </div>
      <ThreeLab />
    </div>
  );
}
