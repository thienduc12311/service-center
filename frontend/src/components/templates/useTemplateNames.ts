import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { templateNoticeText, type TemplatePreviewNotice, type TemplatePreviewTemplateRef } from '@service-center/shared';
import { useStructuredText } from '../../i18n';
import { usePeople, useTeams } from '../../hooks/queries';

/** Display names for the ids a template holds. */
export interface TemplateNames {
  person: (personId: string) => string;
  team: (teamId: string) => string;
  position: (positionId: string | null) => string;
}

export const useTemplateNames = (): TemplateNames => {
  const { t } = useTranslation(['templates', 'common']);
  const people = usePeople();
  const teams = useTeams();
  return useMemo(() => {
    const personNames = new Map((people.data ?? []).flatMap((person) =>
      person.person_id ? [[person.person_id, person.full_name ?? person.email ?? t('common:fallback.someone')] as const] : []));
    const teamNames = new Map((teams.data ?? []).map((team) => [team.id, team.name] as const));
    const positionNames = new Map((teams.data ?? []).flatMap((team) =>
      team.positions.map((position) => [position.id, t('common:format.teamPosition', { team: team.name, position: position.name })] as const)));
    return {
      person: (personId) => personNames.get(personId) ?? t('names.hiddenPerson'),
      team: (teamId) => teamNames.get(teamId) ?? t('names.unknownTeam'),
      position: (positionId) => (positionId ? positionNames.get(positionId) ?? t('names.unknownPosition') : t('names.anyPosition')),
    };
  }, [people.data, teams.data, t]);
};

/** Preview notice codes whose text needs no values from the server. */
const PLAIN_NOTICE_CODES = ['other_service_type', 'times_in_use', 'notes_too_long', 'roster_appended', 'reset_silent'] as const;
type PlainNoticeCode = (typeof PLAIN_NOTICE_CODES)[number];
const isPlainNoticeCode = (code: string): code is PlainNoticeCode => (PLAIN_NOTICE_CODES as readonly string[]).includes(code);

/** Values a notice's translation can take from the preview it belongs to. */
export interface TemplateNoticeContext {
  template?: Pick<TemplatePreviewTemplateRef, 'revision' | 'latest_revision'>;
}

export type TemplateNoticeText = (notice: TemplatePreviewNotice, context?: TemplateNoticeContext) => string;

/**
 * Localized text for a template/reschedule preview notice, by its stable
 * code and structured `params`. Notices from before structured params keep
 * the server's message, except `older_revision`, whose values the preview's
 * template reference supplies.
 */
export const useTemplateNoticeText = (): TemplateNoticeText => {
  const { t } = useTranslation('templates');
  const structured = useStructuredText();
  return useCallback<TemplateNoticeText>(
    (notice, context) => {
      if (isPlainNoticeCode(notice.code)) return t(`notices.${notice.code}`);
      if (notice.code === 'older_revision' && !notice.params && context?.template) {
        return t('notices.older_revision', { revision: context.template.revision, latest: context.template.latest_revision });
      }
      return templateNoticeText(notice, structured);
    },
    [t, structured],
  );
};
