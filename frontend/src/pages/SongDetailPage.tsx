import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { MUSICAL_KEYS, semitonesBetween } from '@service-center/shared';
import { api } from '../lib/api';
import { useSong, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Badge, Button, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';
import { ChordChart } from '../components/ChordChart';

export const SongDetailPage = () => {
  const { songId } = useParams<{ songId: string }>();
  const { canManage } = useAuth();
  const invalidate = useInvalidateOrg();
  const song = useSong(songId);

  const [arrangementId, setArrangementId] = useState<string | null>(null);
  const [displayKey, setDisplayKey] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const arrangements = song.data?.arrangements ?? [];
  const arrangement =
    arrangements.find((a) => a.id === arrangementId) ??
    arrangements.find((a) => a.is_default) ??
    arrangements[0];

  const saveChart = useMutation({
    mutationFn: () => api.updateArrangement(arrangement!.id, { chord_chart: draft }),
    onSuccess: async () => {
      await invalidate();
      setEditing(false);
    },
  });

  if (song.isLoading) return <Loading />;
  if (song.error) return <ErrorNotice error={song.error} />;
  if (!song.data) return <EmptyState title="Song not found" />;

  const baseKey = arrangement?.song_key ?? song.data.default_key ?? null;
  const semitones =
    displayKey && baseKey ? (semitonesBetween(baseKey, displayKey) ?? 0) : 0;
  const prefer = displayKey.includes('b') ? 'flats' : 'sharps';

  return (
    <div>
      <PageHeader
        title={song.data.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {song.data.author && <span>{song.data.author}</span>}
            {song.data.ccli_number && <span>· CCLI {song.data.ccli_number}</span>}
            {song.data.default_bpm && <span>· {song.data.default_bpm} bpm</span>}
            {song.data.meter && <span>· {song.data.meter}</span>}
          </span>
        }
        actions={<Link to="/songs"><Button variant="secondary">All songs</Button></Link>}
      />

      {song.data.themes.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {song.data.themes.map((theme) => (
            <Badge key={theme} tone="bg-slate-100 text-slate-600 ring-slate-500/20">
              {theme}
            </Badge>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {arrangements.length > 1 && (
          <select
            aria-label="Arrangement"
            className="input w-56"
            value={arrangement?.id ?? ''}
            onChange={(e) => setArrangementId(e.target.value)}
          >
            {arrangements.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.is_default ? ' (default)' : ''}
              </option>
            ))}
          </select>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-600">
          Key
          <select
            aria-label="Transpose to key"
            className="input w-24"
            value={displayKey}
            onChange={(e) => setDisplayKey(e.target.value)}
          >
            <option value="">{baseKey ?? 'Original'}</option>
            {MUSICAL_KEYS.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>

        {semitones !== 0 && (
          <span className="text-xs text-slate-400">
            transposed {semitones > 6 ? semitones - 12 : semitones} semitones
          </span>
        )}

        {canManage && arrangement && !editing && (
          <Button
            variant="secondary"
            className="ml-auto"
            onClick={() => {
              setDraft(arrangement.chord_chart ?? '');
              setEditing(true);
            }}
          >
            {arrangement.chord_chart ? 'Edit chart' : 'Add chart'}
          </Button>
        )}
      </div>

      {arrangement?.sequence.length ? (
        <p className="mb-4 text-sm text-slate-500">
          Sequence: <span className="font-mono">{arrangement.sequence.join(' · ')}</span>
        </p>
      ) : null}

      <div className="card p-5">
        {editing ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              ChordPro format — put chords in square brackets, e.g.{' '}
              <code className="rounded bg-slate-100 px-1">A[G]mazing grace</code>
            </p>
            <textarea
              className="input font-mono"
              rows={20}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Chord chart source"
            />
            <ErrorNotice error={saveChart.error} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button loading={saveChart.isPending} onClick={() => saveChart.mutate()}>
                Save chart
              </Button>
            </div>
          </div>
        ) : arrangement?.chord_chart ? (
          <ChordChart chordpro={arrangement.chord_chart} semitones={semitones} prefer={prefer} />
        ) : (
          <EmptyState
            title="No chord chart yet"
            description="Paste one in ChordPro format, or import it from a photo."
            action={
              <Link to="/imports">
                <Button variant="secondary">Import from image</Button>
              </Link>
            }
          />
        )}
      </div>

      {song.data.notes && (
        <div className="card mt-4 p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-700">Notes</h2>
          <p className="whitespace-pre-wrap text-sm text-slate-600">{song.data.notes}</p>
        </div>
      )}
    </div>
  );
};
