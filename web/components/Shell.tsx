"use client";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
export default function Shell({ children }: { children: React.ReactNode }) {
  if (usePathname() === "/login") return <>{children}</>;
  return <div className="shell"><Sidebar /><div className="content">{children}</div></div>;
}
