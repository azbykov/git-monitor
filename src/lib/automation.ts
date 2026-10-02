/**
 * PR от ботов: обновления зависимостей и релизы. Snyk/Dependabot/Renovate/release-please часто открывают PR от имени пользователя,
 * поэтому по автору их не отличить — смотрим на ветку и заголовок.
 * Такие PR показываем отдельно и не считаем в аналитике: иначе они забивают список и искажают метрики.
 */
const BOT_BRANCH = /^(snyk-|dependabot\/|renovate\/|depfu\/|greenkeeper\/|pyup-|release-please--)/i;
const BOT_TITLE = /^\[snyk\]|^bump .+ from .+ to |^chore\(deps(-dev)?\):|^chore\([\w.-]+\): release /i;

export function isAutomatedPr(pr: { title: string; headRef?: string | null; authorIsBot?: boolean }): boolean {
  return Boolean(pr.authorIsBot || (pr.headRef && BOT_BRANCH.test(pr.headRef)) || BOT_TITLE.test(pr.title));
}

/** PR старше этого числа дней считаем заброшенными — кандидаты закрыть (как «>30 days old» у Swarmia). */
export const OLD_PR_DAYS = 30;
