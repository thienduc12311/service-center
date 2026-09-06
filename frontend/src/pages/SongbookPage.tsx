import { useParams } from 'react-router-dom';
import { ChordChart } from '../components/ChordChart';
import { useSongbook } from '../hooks/queries';
import { Button, ErrorNotice, Loading, PageHeader } from '../components/ui';

export const SongbookPage = () => {
  const { songbookId } = useParams();
  const book = useSongbook(songbookId);
  if (book.isLoading) return <Loading label="Opening song book…" />;
  if (book.error || !book.data) return <ErrorNotice error={book.error ?? new Error('Song book not found')} />;

  return (
    <article className="mx-auto max-w-4xl print:max-w-none">
      <PageHeader title={book.data.title} subtitle={book.data.description} actions={<Button variant="secondary" onClick={() => window.print()}>Print / export PDF</Button>} />
      {book.data.source_type === 'document' ? (
        book.data.document_url ? <iframe title={book.data.title} src={book.data.document_url} className="h-[75vh] w-full rounded-2xl border border-slate-200 bg-white dark:border-slate-800" /> : <p>Document preview is unavailable.</p>
      ) : (
        <div className="space-y-8">
          {book.data.items.map((item, index) => (
            <section key={item.id} className="card break-after-page p-6 sm:p-10">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">Song {index + 1}</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">{item.song.title}</h2>
              <p className="mb-6 text-sm text-slate-500">{item.song.author}{item.arrangement?.song_key ? ` · Key ${item.arrangement.song_key}` : ''}</p>
              {item.arrangement?.chord_chart ? <ChordChart chordpro={item.arrangement.chord_chart} /> : <p className="text-sm text-slate-400">No chart has been added for this song.</p>}
              {item.song.copyright && <p className="mt-8 text-xs text-slate-400">{item.song.copyright}</p>}
            </section>
          ))}
        </div>
      )}
    </article>
  );
};
