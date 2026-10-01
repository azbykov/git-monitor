import { getSelectedOrg, listMyOrgs, type Org } from "@/lib/org";
import { getSession } from "@/lib/session";
import { logoutAction } from "@/app/actions";
import { devGithubToken } from "@/lib/dev-auth";
import { OrgSelect } from "./org-select";

/** Страница OAuth-приложения в настройках GitHub: там выдают или запрашивают доступ к организациям. */
function manageUrl() {
  const clientId = process.env.AUTH_GITHUB_ID;
  return clientId && !devGithubToken() ? `https://github.com/settings/connections/applications/${clientId}` : null;
}

/** Правая часть шапки: выбор организации и пользователь. Без сессии — пусто. */
export async function NavUser() {
  const session = await getSession();
  if (!session) return null;

  let orgs: Org[] = [];
  try {
    orgs = await listMyOrgs(session.sealed);
  } catch (e) {
    console.error("[nav-user] listMyOrgs failed:", e); // TEMP-DEBUG
  }
  const selected = await getSelectedOrg();
  if (selected && !orgs.some((o) => o.login === selected)) orgs.unshift({ login: selected, avatarUrl: null });

  return (
    <div className="flex items-center gap-3">
      <OrgSelect orgs={orgs.map((o) => o.login)} selected={selected} manageUrl={manageUrl()} />
      <form action={logoutAction} className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={session.user.avatarUrl} alt="" className="size-6 rounded-full" />
        <span className="hidden text-zinc-600 md:inline dark:text-zinc-400">{session.user.login}</span>
        {session.user.source === "owner" && (
          <span
            className="rounded bg-violet-500/15 px-1.5 py-0.5 text-xs text-violet-700 dark:text-violet-400"
            title="Данные загружаются по вашему личному токену из OWNER_GITHUB_TOKEN"
          >
            PAT
          </span>
        )}
        {session.user.source === "dev" ? (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-400" title="DEV_GITHUB_TOKEN, вход отключён">
            dev
          </span>
        ) : (
          <button className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">Выйти</button>
        )}
      </form>
    </div>
  );
}
