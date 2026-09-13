import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { renderChartHtml, type ChartFormatting } from '@service-center/shared';
import { api } from '../lib/api';
import { openChartInNewTab, printChart } from '../lib/chart-print';
import { useInvalidateOrg, useSong } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, EmptyState, ErrorNotice, Loading } from '../components/ui';
import { ChartNotationSelect, ORIGINAL_KEY_VIEW, type ChartView } from '../components/ChartNotationSelect';
import { ChartSourceEditor } from '../components/chart-editor/ChartSourceEditor';
import { ChartPreview } from '../components/chart-editor/ChartPreview';
import { EditSequenceModal } from '../components/chart-editor/EditSequenceModal';
import { ChartFormattingModal } from '../components/chart-editor/ChartFormattingModal';
import {
  chartDocumentFrom,
  chartEditorFormFrom,
  chartEditorIsDirty,
  toChartArrangementInput,
  toChartSongInput,
  type ChartEditorFormValues,
} from '../components/chart-editor/types';

/** Which dialog, if any, is open over the editor. */
type ChartDialog = 'sequence' | 'formatting';

/**
 * The chord chart workspace: the chart on the left, the document it will print
 * as on the right.
 *
 * Edit → live preview → choose a layout → download. The preview, the new tab
 * and the PDF are all the same HTML from the shared template, so the page the
 * band gets is the page that was on screen.
 */
export const ChartEditorPage = () => {
  const { songId, arrangementId } = useParams<{ songId: string; arrangementId: string }>();
  const { canManage } = useAuth();
  const navigate = useNavigate();
  const invalidate = useInvalidateOrg();
  const song = useSong(songId);

  const arrangement = song.data?.arrangements.find((candidate) => candidate.id === arrangementId);

  const [form, setForm] = useState<ChartEditorFormValues | null>(null);
  /** What is currently on the server, so the Save button knows what changed. */
  const [saved, setSaved] = useState<ChartEditorFormValues | null>(null);
  const [view, setView] = useState<ChartView>(ORIGINAL_KEY_VIEW);
  const [dialog, setDialog] = useState<ChartDialog | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [popupBlocked, setPopupBlocked] = useState(false);

  // The song loads after the first render, so the form is seeded once it lands
  // and re-seeded whenever a save brings a new version of the arrangement back.
  useEffect(() => {
    if (!song.data || !arrangement) return;
    const values = chartEditorFormFrom(song.data, arrangement);
    setSaved(values);
    setForm((current) => current ?? values);
  }, [song.data, arrangement]);

  const html = useMemo(() => {
    if (!form || !song.data) return '';
    return renderChartHtml(chartDocumentFrom({ values: form, song: song.data, view }));
  }, [form, song.data, view]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form || !song.data || !arrangement) return;
      if (form.title.trim() && form.title.trim() !== song.data.title) {
        await api.updateSong(song.data.id, toChartSongInput(form));
      }
      await api.updateArrangement(arrangement.id, toChartArrangementInput(form));
    },
    onSuccess: async () => {
      setSaved(form);
      await invalidate();
    },
  });

  if (song.isLoading) return <Loading />;
  if (song.error) return <ErrorNotice error={song.error} />;
  if (!song.data) return <EmptyState title="Song not found" />;
  if (!arrangement) {
    return (
      <EmptyState
        title="Arrangement not found"
        description="It may have been deleted."
        action={<Link className="text-brand-600 hover:underline" to={`/songs/${songId}`}>Back to the song</Link>}
      />
    );
  }
  if (!form || !saved) return <Loading />;

  const update = <K extends keyof ChartEditorFormValues>(
    field: K,
    value: ChartEditorFormValues[K],
  ) => setForm((current) => (current ? { ...current, [field]: value } : current));

  const dirty = chartEditorIsDirty(form, saved);

  const leave = () => {
    if (dirty && !window.confirm('Leave without saving this chart?')) return;
    navigate(`/songs/${songId}`);
  };

  const openInTab = () => setPopupBlocked(!openChartInNewTab(html));

  return (
    <div className="flex h-dvh flex-col bg-slate-100 dark:bg-slate-950">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={leave}
          className="text-sm text-slate-600 transition hover:text-slate-900 dark:text-slate-300"
        >
          ‹ Back
        </button>

        <h1 className="min-w-0 truncate text-sm font-semibold text-slate-900 dark:text-white">
          {song.data.title}
          <span className="ml-2 font-normal text-slate-400">{arrangement.name}</span>
        </h1>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setDialog('sequence')} disabled={!canManage}>
            Sequence
          </Button>
          <Button variant="secondary" onClick={() => setDialog('formatting')} disabled={!canManage}>
            Formatting
          </Button>
          <Button variant="secondary" onClick={openInTab}>
            Open in new tab
          </Button>
          <Button variant="secondary" onClick={() => printChart(html)}>
            Download PDF
          </Button>
          {canManage && (
            <Button
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={!dirty || !form.title.trim()}
            >
              {dirty ? 'Save' : 'Saved'}
            </Button>
          )}
        </div>
      </header>

      {(save.error || popupBlocked) && (
        <div className="px-4 pt-3">
          <ErrorNotice error={save.error} />
          {popupBlocked && (
            <div role="alert" className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-600/20">
              Your browser blocked the new tab. Allow pop-ups for this site, or use Download PDF.
            </div>
          )}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-2">
        <section className="card flex min-h-0 flex-col p-4">
          <ChartSourceEditor
            values={form}
            disabled={!canManage}
            onChange={update}
            onEditSequence={() => setDialog('sequence')}
          />
        </section>

        <section className="flex min-h-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <ChartNotationSelect value={view} onChange={setView} />
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                className="size-4 rounded border-slate-300"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
              />
              Auto-refresh
            </label>
            <span className="ml-auto text-xs text-slate-400">
              {form.formatting.columns === 2 ? 'Two columns' : 'One column'}
            </span>
          </div>

          <div className="min-h-0 flex-1">
            <ChartPreview html={html} autoRefresh={autoRefresh} />
          </div>
        </section>
      </div>

      <EditSequenceModal
        open={dialog === 'sequence'}
        sequence={form.sequence}
        onClose={() => setDialog(null)}
        onSave={(sequence) => update('sequence', sequence)}
      />

      <ChartFormattingModal
        open={dialog === 'formatting'}
        formatting={form.formatting}
        onClose={() => setDialog(null)}
        onSave={(formatting: ChartFormatting) => update('formatting', formatting)}
      />
    </div>
  );
};
