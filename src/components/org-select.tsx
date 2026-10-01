"use client";

import { useTransition } from "react";
import { setOrgAction } from "@/app/actions";

const ALL = "*";
const MANAGE = "__manage";

/**
 * `manageUrl` — страница приложения в настройках GitHub, где выдают доступ к организациям.
 * Организации с ограничением доступа для OAuth-приложений не видны, пока владелец его не одобрит.
 */
export function OrgSelect(props: { orgs: string[]; selected: string | null; manageUrl: string | null }) {
  const { orgs, selected, manageUrl } = props;
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="hidden text-zinc-500 sm:inline">Организация</span>
      <select
        value={selected ?? ALL}
        disabled={pending}
        onChange={(e) => {
          if (e.target.value === MANAGE) {
            window.open(manageUrl!, "_blank", "noopener");
            return; // value контролируемый — select сам вернётся к выбранной организации
          }
          startTransition(() => setOrgAction(e.target.value));
        }}
        className="max-w-40 rounded-md border border-zinc-200 bg-transparent px-2 py-1 disabled:opacity-50 dark:border-zinc-800"
      >
        <option value={ALL}>Все</option>
        {orgs.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        {manageUrl && (
          <>
            <option disabled>──────────</option>
            <option value={MANAGE}>Доступ к организациям…</option>
          </>
        )}
      </select>
    </label>
  );
}
