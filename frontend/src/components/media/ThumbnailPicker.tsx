import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileSummary } from '@service-center/shared';
import { api } from '../../lib/api';
import { matchesSearch } from '../../lib/search';
import { Icon } from '../icons';
import { ListFooter } from '../ListFooter';

export interface ThumbnailPickerProps {
  /** Image files the bundle can use (finalized uploads, not archived). */
  images: readonly FileSummary[];
  /** The current thumbnail's file id; null for none. */
  value: string | null;
  onChange: (fileId: string | null) => void;
  disabled?: boolean;
}

/** Tiles drawn at once; "Show more" adds this many again. */
const PAGE_SIZE = 12;
/** Below this many images the search box is noise. */
const SEARCH_FROM = 7;

/**
 * Chooses a bundle's thumbnail by looking at the images instead of reading
 * their titles: a grid of previews, a title search once there are several,
 * and a "None" tile to clear it.
 */
export const ThumbnailPicker = ({ images, value, onChange, disabled = false }: ThumbnailPickerProps) => {
  const { t } = useTranslation(['media', 'common']);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const matches = images.filter((file) => matchesSearch(query, [file.title]));
  const shown = matches.slice(0, limit);

  return (
    <div className="space-y-2">
      {images.length >= SEARCH_FROM && (
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            className="input !pl-9"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(PAGE_SIZE);
            }}
            placeholder={t('thumbnail.searchPlaceholder')}
            aria-label={t('thumbnail.searchLabel')}
          />
        </div>
      )}
      <div role="radiogroup" aria-label={t('thumbnail.selectLabel')} className="grid grid-cols-3 gap-2">
        <TileButton selected={value === null} disabled={disabled} label={t('common:states.none')} onSelect={() => onChange(null)}>
          <span className="grid size-full place-items-center text-slate-400">
            <Icon name="close" className="size-5" />
          </span>
        </TileButton>
        {shown.map((file) => (
          <TileButton
            key={file.id}
            selected={value === file.id}
            disabled={disabled}
            label={file.title}
            onSelect={() => onChange(file.id)}
          >
            <ImagePreview fileId={file.id} />
          </TileButton>
        ))}
      </div>
      {matches.length === 0 && query && <p className="text-xs text-slate-500">{t('thumbnail.noMatch')}</p>}
      <ListFooter
        shown={shown.length}
        total={matches.length}
        onShowMore={matches.length > shown.length ? () => setLimit((current) => current + PAGE_SIZE) : undefined}
      />
    </div>
  );
};

interface TileButtonProps {
  selected: boolean;
  disabled: boolean;
  /** The image title (or "None"): the tile's accessible name and caption. */
  label: string;
  onSelect: () => void;
  children: ReactNode;
}

const TileButton = ({ selected, disabled, label, onSelect, children }: TileButtonProps) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onSelect}
    className={`group flex min-w-0 flex-col overflow-hidden rounded-lg text-left ring-inset transition disabled:opacity-60 ${
      selected ? 'ring-2 ring-brand-600' : 'ring-1 ring-app-border hover:ring-brand-300'
    }`}
  >
    <span className="block aspect-video w-full bg-slate-100 dark:bg-slate-800">{children}</span>
    <span className="block truncate px-1.5 py-1 text-[11px] text-slate-600 dark:text-slate-300">{label}</span>
  </button>
);

interface ImagePreviewProps {
  fileId: string;
}

/** A short-lived inline URL for one image; a grey tile until it arrives or if it fails. */
const ImagePreview = ({ fileId }: ImagePreviewProps) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api
      .fileDownload(fileId, { disposition: 'inline' })
      .then((result) => live && setUrl(result.url))
      // A preview that cannot load stays a blank tile; the title still names it.
      .catch(() => live && setUrl(null));
    return () => {
      live = false;
    };
  }, [fileId]);
  return url ? <img src={url} alt="" loading="lazy" className="size-full object-cover" /> : null;
};
