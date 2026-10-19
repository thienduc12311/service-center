import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { SongRow, SongMergePreview } from '@service-center/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../providers/AuthProvider';
import { useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice } from '../ui';

export const SongMergePanel = ({ song }: { song: SongRow }) => {
  const { organizationId, user } = useAuth();
  return <MergeWorkspace key={`${organizationId}:${user?.profile.id}:${song.id}`} song={song} />;
};
const MergeWorkspace = ({ song }: { song: SongRow }) => {
  const { organizationId, user } = useAuth();
  const navigate = useNavigate();
  const invalidate = useInvalidateOrg();
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [expanded, setExpanded] = useState(false);
  const [winnerId, setWinnerId] = useState('');
  const [preview, setPreview] = useState<SongMergePreview | null>(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const candidates = useQuery({ queryKey: ['song-duplicates', organizationId, user?.profile.id, song.id], queryFn: () => api.getSongDuplicates(song.id), enabled: expanded });
  const review = useMutation({ mutationFn: () => api.previewSongMerge({ winner_id: winnerId, loser_id: song.id }), onSuccess: (r) => { if (active.current) setPreview(r); } });
  const merge = useMutation({ mutationFn: () => api.mergeSongs({ winner_id: preview!.winner_id, loser_id: preview!.loser_id, fingerprint: preview!.fingerprint, idempotency_key: requestKey }),
    onSuccess: async (r) => { if (!active.current) return; await invalidate(); if (active.current) navigate(`/songs/${r.winner_id}`); } });
  const busy = review.isPending || merge.isPending;
  return <details className="card p-5" onToggle={(e) => setExpanded(e.currentTarget.open)}>
    <summary className="cursor-pointer font-semibold">Find duplicate songs / merge</summary>
    <div className="mt-4 space-y-3">
      <p className="text-sm">Suggestions match exact trimmed title or CCLI. Review deliberately; this song becomes the retained, read-only historical record. The selected song keeps its metadata and default.</p>
      <ErrorNotice error={candidates.error ?? review.error ?? merge.error} />
      {candidates.isLoading && <p>Finding duplicates…</p>}
      {candidates.data?.length === 0 && <p>No matching title or CCLI suggestions.</p>}
      <label className="label">Song to keep<select className="input" disabled={busy || !!preview} value={winnerId} onChange={(e) => setWinnerId(e.target.value)}><option value="">Choose a duplicate</option>{candidates.data?.map((c) => <option key={c.id} value={c.id}>{c.title} · matching {c.reason}</option>)}</select></label>
      {!preview && <Button disabled={busy || !winnerId} onClick={() => review.mutate()}>Preview merge</Button>}
      {preview && <div className="space-y-3" aria-live="polite">
        <p>Keep “{preview.winner_title}”; merge “{preview.loser_title}”.</p>
        <p>Review covers both songs: {preview.arrangements} arrangements, {preview.keys} labeled keys, {preview.files} files, {preview.plan_items} plan items, {preview.songbook_items} songbook entries and {preview.template_revisions} template revisions.</p>
        <p className="text-sm">{preview.policy}</p>
        <details className="space-y-2"><summary className="cursor-pointer font-medium">Inspect metadata, defaults, files and references</summary>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Metadata conflict policy</caption><thead><tr><th>Field</th><th>Kept</th><th>Losing value retained in history</th></tr></thead><tbody>{preview.metadata.map((m) => <tr key={m.field}><th className="py-2 pr-3">{m.field.replaceAll('_', ' ')}</th><td className="pr-3">{JSON.stringify(m.kept)}</td><td>{JSON.stringify(m.losing)}</td></tr>)}</tbody></table></div>
          <p className="text-sm">Arrangements retain IDs. Names and key labels may repeat under different arrangements. Existing losing references with an inherited arrangement are fixed to its original default. General song files become shared by the kept song.</p>
          <ul className="space-y-1 break-words text-sm">{preview.arrangement_details.map((a) => <li key={a.id}>{a.name} · {a.song_key ?? 'inherits song key'} · {a.song_id === preview.loser_id ? 'moves to kept song' : 'stays'}{a.is_default ? a.song_id === preview.winner_id ? ' · kept default' : ' · losing default frozen on references' : ''}{a.archived_at ? ' · archived history' : ''} · {a.id}</li>)}</ul>
          <ul className="space-y-1 break-words text-sm">{preview.key_details.map((k) => <li key={k.id}>{k.label} · {k.song_key} · capo {k.capo ?? 'none'} · {k.vocal_label ?? 'no vocal label'} · arrangement {k.arrangement_id}</li>)}</ul>
          <ul className="space-y-1 break-words text-sm">{preview.file_details.map((f) => <li key={f.id}>{f.title} · audience {f.audience} · {f.playback_rights} · {f.arrangement_id ? `arrangement ${f.arrangement_id}` : 'general song file'}</li>)}</ul>
          <ul className="space-y-1 break-words text-sm">{preview.plan_references.map((i) => <li key={i.id}><a className="underline" href={`/plans/${i.parent_id}`}>{i.title}</a> · {i.song_id === preview.loser_id ? 'remap' : 'keep'} · arrangement {i.arrangement_id ?? 'song default'} · key {i.key_override ?? 'inherited'} · item {i.id}</li>)}</ul>
          <ul className="space-y-1 break-words text-sm">{preview.book_references.map((i) => <li key={i.id}>Songbook {i.parent_id} · {i.song_id === preview.loser_id ? 'remap and keep version' : 'keep'} · arrangement {i.arrangement_id ?? 'song default'} · entry {i.id}</li>)}</ul>
          <ul className="space-y-1 break-words text-sm">{preview.template_details.map((t) => <li key={t.id}>Template {t.template_id} revision {t.revision} remains immutable; later use selects the kept song and original arrangement.</li>)}</ul>
          <p className="text-sm">{preview.live_history} pinned live snapshots remain immutable. Existing offline copies refresh when the client next syncs.</p>
        </details>
        {preview.blockers.length > 0 && <ul className="list-inside list-disc">{preview.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
        <Button variant="danger" disabled={busy || preview.blockers.length > 0} onClick={() => merge.mutate()}>Merge reviewed songs</Button>{' '}
        <Button variant="secondary" disabled={busy} onClick={() => { setPreview(null); setRequestKey(crypto.randomUUID()); merge.reset(); review.reset(); }}>Change / refresh review</Button>
        {merge.isError && <p className="text-sm">For an unknown outcome, retry this request. Changed references require a new review. No rows are partially merged.</p>}
      </div>}
    </div>
  </details>;
};
