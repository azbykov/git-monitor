"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Мои PR" },
  { href: "/reviews", label: "Ревью" },
  { href: "/analytics", label: "Аналитика" },
  { href: "/feedback", label: "Замечания" },
];

export function Nav({ right }: { right?: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <nav className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 text-sm sm:gap-6">
        <span className="hidden py-3 font-semibold sm:inline">Git Monitor</span>
        {pathname !== "/login" && LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`-mb-px border-b-2 py-3 ${
              pathname === l.href
                ? "border-zinc-900 dark:border-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
          >
            {l.label}
          </Link>
        ))}
        <div className="ml-auto">{right}</div>
      </div>
    </nav>
  );
}
