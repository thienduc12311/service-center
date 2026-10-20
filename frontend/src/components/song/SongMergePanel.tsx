import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { SongRow, SongMergePreview } from '@service-center/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../providers/AuthProvider';
import { useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice } from '../ui';

/** Props of the duplicate-finding and merge panel. */
export interface SongMergePanelProps {
  song: SongRow;
}

export const SongMergePanel = ({ song }: SongMergePanelProps) => {
  const { organizationId, user } = useAuth();
  return <MergeWorkspace key={`${organizationId}:${user?.profile.id}:${song.id}`} song={song} />;
};
const MergeWorkspace = ({ song }: SongMergePanelProps) => {
  const { t } = useTranslation(['songs', 'common']);
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
    <summary className="cursor-pointer font-semibold">{t('merge.summary')}</summary>
    <div className="mt-4 space-y-3">
      <p className="text-sm">{t('merge.intro')}</p>
      <ErrorNotice error={candidates.error ?? review.error ?? merge.error} />
      {candidates.isLoading && <p>{t('merge.finding')}</p>}
      {candidates.data?.length === 0 && <p>{t('merge.noSuggestions')}</p>}
      <label className="label">{t('merge.songToKeep')}<select className="input" disabled={busy || !!preview} value={winnerId} onChange={(e) => setWinnerId(e.target.value)}><option value="">{t('merge.chooseDuplicate')}</option>{candidates.data?.map((c) => <option key={c.id} value={c.id}>{t(c.reason === 'ccli' ? 'merge.matchingCcli' : 'merge.matchingTitle', { title: c.title })}</option>)}</select></label>
      {!preview && <Button disabled={busy || !winnerId} onClick={() => review.mutate()}>{t('merge.preview')}</Button>}
      {preview && <div className="space-y-3" aria-live="polite">
        <p>{t('merge.keepAndMerge', { winner: preview.winner_title, loser: preview.loser_title })}</p>
        <p>{t('merge.coverage', { arrangements: preview.arrangements, keys: preview.keys, files: preview.files, planItems: preview.plan_items, songbookItems: preview.songbook_items, templateRevisions: preview.template_revisions })}</p>
        <p className="text-sm">{preview.policy}</p>
        <details className="space-y-2"><summary className="cursor-pointer font-medium">{t('merge.inspect')}</summary>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">{t('merge.metadataCaption')}</caption><thead><tr><th>{t('merge.columns.field')}</th><th>{t('merge.columns.kept')}</th><th>{t('merge.columns.losing')}</th></tr></thead><tbody>{preview.metadata.map((m) => <tr key={m.field}><th className="py-2 pr-3">{m.field.replaceAll('_', ' ')}</th><td className="pr-3">{JSON.stringify(m.kept)}</td><td>{JSON.stringify(m.losing)}</td></tr>)}</tbody></table></div>
          <p className="text-sm">{t('merge.arrangementsNote')}</p>
          <ul className="space-y-1 break-words text-sm">{preview.arrangement_details.map((a) => <li key={a.id}>{[
            a.name,
            a.song_key ?? t('merge.inheritsSongKey'),
            a.song_id === preview.loser_id ? t('merge.movesToKept') : t('merge.stays'),
            a.is_default ? (a.song_id === preview.winner_id ? t('merge.keptDefault') : t('merge.losingDefaultFrozen')) : null,
            a.archived_at ? t('merge.archivedHistory') : null,
            a.id,
          ].filter(Boolean).join(' · ')}</li>)}</ul>
          <ul className="space-y-1 break-words text-sm">{preview.key_details.map((k) => <li key={k.id}>{[
            k.label,
            k.song_key,
            t('merge.capo', { capo: k.capo ?? t('common:states.none') }),
            k.vocal_label ?? t('merge.noVocalLabel'),
            t('merge.arrangementId', { id: k.arrangement_id }),
          ].join(' · ')}</li>)}</ul>
          <ul className="space-y-1 break-words text-sm">{preview.file_details.map((f) => <li key={f.id}>{[
            f.title,
            t('merge.audience', { audience: f.audience }),
            f.playback_rights,
            f.arrangement_id ? t('merge.arrangementId', { id: f.arrangement_id }) : t('merge.generalSongFile'),
          ].join(' · ')}</li>)}</ul>
          <ul className="space-y-1 break-words text-sm">{preview.plan_references.map((i) => <li key={i.id}><a className="underline" href={`/plans/${i.parent_id}`}>{i.title}</a> · {[
            i.song_id === preview.loser_id ? t('merge.remap') : t('merge.keep'),
            t('merge.arrangementId', { id: i.arrangement_id ?? t('merge.songDefault') }),
            t('merge.keyValue', { key: i.key_override ?? t('merge.inherited') }),
            t('merge.itemId', { id: i.id }),
          ].join(' · ')}</li>)}</ul>
          <ul className="space-y-1 break-words text-sm">{preview.book_references.map((i) => <li key={i.id}>{[
            t('merge.songbookId', { id: i.parent_id }),
            i.song_id === preview.loser_id ? t('merge.remapKeepVersion') : t('merge.keep'),
            t('merge.arrangementId', { id: i.arrangement_id ?? t('merge.songDefault') }),
            t('merge.entryId', { id: i.id }),
          ].join(' · ')}</li>)}</ul>
          <ul className="space-y-1 break-words text-sm">{preview.template_details.map((detail) => <li key={detail.id}>{t('merge.templateRevision', { template: detail.template_id, revision: detail.revision })}</li>)}</ul>
          <p className="text-sm">{t('merge.liveHistory', { count: preview.live_history })}</p>
        </details>
        {preview.blockers.length > 0 && <ul className="list-inside list-disc">{preview.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
        <Button variant="danger" disabled={busy || preview.blockers.length > 0} onClick={() => merge.mutate()}>{t('merge.mergeReviewed')}</Button>{' '}
        <Button variant="secondary" disabled={busy} onClick={() => { setPreview(null); setRequestKey(crypto.randomUUID()); merge.reset(); review.reset(); }}>{t('merge.changeReview')}</Button>
        {merge.isError && <p className="text-sm">{t('merge.retryHelp')}</p>}
      </div>}
    </div>
  </details>;
};
