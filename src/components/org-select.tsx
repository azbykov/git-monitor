"use client";

import { useTransition } from "react";
import { setOrgAction } from "@/app/actions";

const ALL = "*";

export function OrgSelect({ orgs, selected }: { orgs: string[]; selected: string | null }) {
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="hidden text-zinc-500 sm:inline">Организация</span>
      <select
        value={selected ?? ALL}
        disabled={pending}
        onChange={(e) => startTransition(() => setOrgAction(e.target.value))}
        className="max-w-40 rounded-md border border-zinc-200 bg-transparent px-2 py-1 disabled:opacity-50 dark:border-zinc-800"
      >
        <option value={ALL}>Все</option>
        {orgs.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
