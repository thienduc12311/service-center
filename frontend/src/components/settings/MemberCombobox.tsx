import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchCombobox, type SearchComboboxOption } from '../SearchCombobox';

/** One person the picker can offer. */
export interface MemberOption {
  /** Profile (user) id — what grants and access checks are keyed by. */
  id: string;
  name: string | null;
  avatarUrl: string | null;
  /** Secondary line, e.g. an email or role. Also searched. */
  detail?: string | null;
}

export interface MemberComboboxProps {
  options: readonly MemberOption[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  /** Hide the visible label (it stays the accessible name). */
  hideLabel?: boolean;
  placeholder?: string;
  /** Ids to leave out of the results (e.g. people already granted). */
  excludeIds?: ReadonlySet<string>;
  disabled?: boolean;
}

/** Maps a member to a combobox option with their avatar. */
export const memberToOption = (member: MemberOption, unnamed: string): SearchComboboxOption => ({
  id: member.id,
  label: member.name ?? unnamed,
  detail: member.detail,
  avatar: { name: member.name, url: member.avatarUrl },
});

/**
 * Type-to-search member picker that stays usable with hundreds of people:
 * the settings-flavoured wrapper around `SearchCombobox`.
 */
export const MemberCombobox = ({ options, placeholder, ...props }: MemberComboboxProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const unnamed = t('common:fallback.unnamed');
  const comboOptions = useMemo(() => options.map((member) => memberToOption(member, unnamed)), [options, unnamed]);
  return (
    <SearchCombobox
      {...props}
      options={comboOptions}
      placeholder={placeholder ?? t('memberPicker.placeholder')}
      noMatchesText={t('memberPicker.noMatches')}
      clearLabel={(name) => t('memberPicker.clear', { name })}
    />
  );
};
