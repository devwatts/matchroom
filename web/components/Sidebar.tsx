"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/", label: "Talents", match: (p: string) => p === "/" || p.startsWith("/talents") },
  { href: "/runs", label: "Live runs", match: (p: string) => p.startsWith("/runs") },
  { href: "/analytics", label: "Analytics", match: (p: string) => p.startsWith("/analytics") },
  { href: "/companies", label: "Company checks", match: (p: string) => p.startsWith("/companies") },
];

export default function Sidebar() {
  const path = usePathname();
  const [badges, setBadges] = useState<{ running: number; checks: number }>({ running: 0, checks: 0 });
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/badges").then(r => r.ok ? r.json() : null).then(b => { if (alive && b) setBadges(b); }).catch(() => {});
    load(); const t = setInterval(load, 10000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return (
    <aside className="side" aria-label="Main">
      <Link href="/" className="logo linkbtn"><span><i></i><i></i></span>matchroom</Link>
      <nav className="snav">
        {NAV.map(n => (
          <Link key={n.href} href={n.href} className="linkbtn" aria-current={n.match(path) ? "page" : undefined}
                style={{ font: "800 15px var(--display)", padding: "10px 12px", borderRadius: 12, justifyContent: "space-between" }}>
            {n.label}
            {n.href === "/runs" && badges.running > 0 && <span className="live-dot" aria-label={`${badges.running} running`}></span>}
            {n.href === "/companies" && badges.checks > 0 && <span className="n">{badges.checks}</span>}
          </Link>
        ))}
      </nav>
      <div className="foot mono muted">New York jobs · daily 08:00</div>
    </aside>
  );
}
