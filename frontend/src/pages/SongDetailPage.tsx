import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { renderChordProChart, toChordPro } from '@service-center/shared';
import { api } from '../lib/api';
import { useSong, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Badge, Button, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';
import { ChordChart } from '../components/ChordChart';
import {
  ChartNotationSelect,
  ORIGINAL_KEY_VIEW,
  type ChartView,
} from '../components/ChartNotationSelect';

export const SongDetailPage = () => {
  const { songId } = useParams<{ songId: string }>();
  const { canManage } = useAuth();
  const invalidate = useInvalidateOrg();
  const song = useSong(songId);

  const [arrangementId, setArrangementId] = useState<string | null>(null);
  const [view, setView] = useState<ChartView>(ORIGINAL_KEY_VIEW);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const arrangements = song.data?.arrangements ?? [];
  const arrangement =
    arrangements.find((candidate) => candidate.id === arrangementId) ??
    arrangements.find((candidate) => candidate.is_default) ??
    arrangements[0];

  const saveChart = useMutation({
    mutationFn: () => api.updateArrangement(arrangement!.id, { chord_chart: toChordPro(draft) }),
    onSuccess: async () => {
      await invalidate();
      setEditing(false);
    },
  });

  if (song.isLoading) return <Loading />;
  if (song.error) return <ErrorNotice error={song.error} />;
  if (!song.data) return <EmptyState title="Song not found" />;

  const sourceKey = arrangement?.song_key ?? song.data.default_key ?? null;
  // Ask the shared renderer what this view resolves to, so the readout and the
  // chart below it can never disagree.
  const rendered = renderChordProChart(arrangement?.chord_chart ?? '', {
    sourceKey,
    targetKey: view.targetKey,
    notation: view.notation,
  });

  const tags = [...song.data.song_types, ...song.data.themes];

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
            {song.data.style && <span>· {song.data.style}</span>}
            {song.data.speed && <span>· {song.data.speed}</span>}
          </span>
        }
        actions={<Link to="/songs"><Button variant="secondary">All songs</Button></Link>}
      />

      {tags.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Badge key={tag} tone="bg-slate-100 text-slate-600 ring-slate-500/20">
              {tag}
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
            onChange={(event) => setArrangementId(event.target.value)}
          >
            {arrangements.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
                {candidate.is_default ? ' (default)' : ''}
              </option>
            ))}
          </select>
        )}

        <span className="text-sm text-slate-500">
          Original Key <span className="font-medium text-slate-700">{sourceKey ?? '—'}</span>
          {arrangement?.capo ? ` · Capo ${arrangement.capo}` : ''}
        </span>

        <ChartNotationSelect value={view} onChange={setView} />

        {rendered.semitones !== 0 && (
          <span className="text-xs text-slate-400">
            transposed {rendered.semitones > 6 ? rendered.semitones - 12 : rendered.semitones} semitones
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
              Paste chords above lyrics, or write ChordPro with the chords in square brackets —{' '}
              <code className="rounded bg-slate-100 px-1">A[G]mazing grace</code>. Either is saved
              as ChordPro.
            </p>
            <textarea
              className="input font-mono"
              rows={20}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
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
          <ChordChart
            chordpro={arrangement.chord_chart}
            sourceKey={sourceKey}
            targetKey={view.targetKey}
            notation={view.notation}
          />
        ) : (
          <EmptyState
            title="No chord chart yet"
            description="Paste one in ChordPro format to transpose it and read it as numbers or numerals."
            action={
              canManage ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDraft('');
                    setEditing(true);
                  }}
                >
                  Add chart
                </Button>
              ) : undefined
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
