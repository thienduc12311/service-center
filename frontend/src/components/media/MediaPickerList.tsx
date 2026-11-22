import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { formatDuration, type MediaSummary } from '@service-center/shared';
import { useMediaList } from '../../hooks/queries';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { Button, ErrorNotice, Loading } from '../ui';
import { MediaThumbnail } from './MediaThumbnail';

export interface MediaPickerListProps {
  /** The bundle already chosen; its button reads `chosenLabel` and is disabled. */
  selectedId: string | null;
  /** The bundle whose choice is saving, if any. */
  pendingId?: string | null;
  /** The button on every other row ("Link", "Choose"). */
  chooseLabel: string;
  chosenLabel: string;
  onChoose: (media: MediaSummary) => void;
}

/**
 * F14: the searchable media library list a plan editor picks a bundle from.
 * Archived bundles are never offered (the list endpoint leaves them out).
 */
export const MediaPickerList = ({ selectedId, pendingId = null, chooseLabel, chosenLabel, onChoose }: MediaPickerListProps) => {
  const { t } = useTranslation('media');
  const [query, setQuery] = useState('');
  const settled = useDebouncedValue(query.trim());
  const list = useMediaList({ q: settled || undefined });
  const media = list.data?.media ?? [];

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="label">{t('linkMedia.find')}</span>
        <input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('form.title')} />
      </label>
      {list.isLoading ? (
        <Loading />
      ) : list.isError ? (
        <ErrorNotice error={list.error} />
      ) : media.length === 0 ? (
        <p className="text-sm text-slate-500">
          <Trans t={t} i18nKey="linkMedia.noneFound" components={[<Link key="library" className="underline" to="/media" />]} />
        </p>
      ) : (
        <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
          {media.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2">
              <span className="flex min-w-0 items-center gap-3">
                <MediaThumbnail fileId={row.thumbnail_file_id} alt={t('thumbnail.alt', { title: row.title })} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{row.title}</span>
                  <span className="text-xs text-slate-500">
                    {[row.creator, row.duration_seconds ? formatDuration(row.duration_seconds) : null, ...row.themes]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </span>
              <Button
                type="button"
                variant={selectedId === row.id ? 'primary' : 'secondary'}
                disabled={selectedId === row.id}
                loading={pendingId === row.id}
                onClick={() => onChoose(row)}
              >
                {selectedId === row.id ? chosenLabel : chooseLabel}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
