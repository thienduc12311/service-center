import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LocalizedError } from '@service-center/shared';
import { ChordChart } from '../components/ChordChart';
import { useSongbook } from '../hooks/queries';
import { Button, ErrorNotice, Loading, PageHeader } from '../components/ui';

export const SongbookPage = () => {
  const { t } = useTranslation(['songs', 'common']);
  const { songbookId } = useParams();
  const book = useSongbook(songbookId);
  if (book.isLoading) return <Loading label={t('songbookPage.opening')} />;
  if (book.error || !book.data) return <ErrorNotice error={book.error ?? new LocalizedError({ key: 'songs:errors.songbookNotFound' })} />;

  return (
    <article className="mx-auto max-w-4xl print:max-w-none">
      <PageHeader title={book.data.title} subtitle={book.data.description} actions={<Button variant="secondary" onClick={() => window.print()}>{t('songbookPage.print')}</Button>} />
      {book.data.source_type === 'document' ? (
        book.data.document_url ? <iframe title={book.data.title} src={book.data.document_url} className="h-[75vh] w-full rounded-2xl border border-slate-200 bg-white dark:border-slate-800" /> : <p>{t('songbookPage.previewUnavailable')}</p>
      ) : (
        <div className="space-y-8">
          {book.data.items.map((item, index) => (
            <section key={item.id} className="card break-after-page p-6 sm:p-10">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">{t('songbookPage.songNumber', { number: index + 1 })}</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">{item.song.title}</h2>
              <p className="mb-6 text-sm text-slate-500">{item.arrangement?.song_key
                  ? t(item.song.author ? 'songbookPage.authorAndKey' : 'songbookPage.keyOnly', { author: item.song.author, key: item.arrangement.song_key })
                  : item.song.author}</p>
              {item.arrangement?.chord_chart ? <ChordChart chordpro={item.arrangement.chord_chart} /> : <p className="text-sm text-slate-400">{t('songbookPage.noChart')}</p>}
              {item.song.copyright && <p className="mt-8 text-xs text-slate-400">{item.song.copyright}</p>}
            </section>
          ))}
        </div>
      )}
    </article>
  );
};
