import { getSelectedOrg, listMyOrgs, type Org } from "@/lib/org";
import { getSession } from "@/lib/session";
import { logoutAction } from "@/app/actions";
import { OrgSelect } from "./org-select";

/** Правая часть шапки: выбор организации и пользователь. Без сессии — пусто. */
export async function NavUser() {
  const session = await getSession();
  if (!session) return null;

  let orgs: Org[] = [];
  try {
    orgs = await listMyOrgs(session.sealed);
  } catch {
    // ошибку GitHub покажет основная страница
  }
  const selected = await getSelectedOrg();
  if (selected && !orgs.some((o) => o.login === selected)) orgs.unshift({ login: selected, avatarUrl: null });

  return (
    <div className="flex items-center gap-3">
      <OrgSelect orgs={orgs.map((o) => o.login)} selected={selected} />
      <form action={logoutAction} className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={session.user.avatarUrl} alt="" className="size-6 rounded-full" />
        <span className="hidden text-zinc-600 md:inline dark:text-zinc-400">{session.user.login}</span>
        <button className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">Выйти</button>
      </form>
    </div>
  );
}
