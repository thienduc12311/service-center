import { useTranslation } from 'react-i18next';
import { SearchCombobox, type SearchComboboxOption } from './SearchCombobox';

export interface SearchableSelectProps {
  label: string;
  hideLabel?: boolean;
  /** Selected option id; `''` when nothing is chosen. */
  value: string;
  onChange: (id: string) => void;
  /** Every choice; set `group` to list them under headings (e.g. positions by team). */
  options: readonly SearchComboboxOption[];
  /** The most likely choices, listed first under `suggestedLabel`. */
  suggested?: readonly SearchComboboxOption[];
  suggestedLabel?: string;
  /** Heading for options without a group, when headings are shown. */
  restLabel?: string;
  placeholder?: string;
  noMatchesText?: string;
  disabled?: boolean;
  id?: string;
}

/** Org data stays well under this, so the whole list is browsable without typing. */
const SELECT_MAX_RESULTS = 500;

/**
 * A select for org data that outgrows a native `<select>` (15–100 teams,
 * positions, templates): the whole list on focus, grouped, likely choices
 * first, and type-to-filter.
 */
export const SearchableSelect = ({ placeholder, ...props }: SearchableSelectProps) => {
  const { t } = useTranslation('common');
  return (
    <SearchCombobox
      {...props}
      placeholder={placeholder ?? t('combobox.selectPlaceholder')}
      maxResults={SELECT_MAX_RESULTS}
    />
  );
};
