import { useEffect, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  CAPO_POSITIONS,
  type ArrangementRow,
  type SongWithArrangements,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice, Modal } from '../ui';
import { KeySelect } from '../KeySelect';
import {
  arrangementFormFrom,
  newArrangementForm,
  toCreateArrangementInput,
  toUpdateArrangementInput,
  type ArrangementFormValues,
} from './types';

export interface ArrangementModalProps {
  open: boolean;
  song: SongWithArrangements;
  /** The arrangement being edited. Null adds a new one to the song. */
  arrangement: ArrangementRow | null;
  onClose: () => void;
  /** Called with the saved arrangement, so the caller can select it. */
  onSaved?: (arrangement: ArrangementRow) => void;
}

/**
 * Adds or edits one arrangement — how a particular band plays the song: its
 * key, capo, tempo and section order. The chart itself is edited in place on
 * the arrangement pane, not here.
 */
export const ArrangementModal = ({
  open,
  song,
  arrangement,
  onClose,
  onSaved,
}: ArrangementModalProps) => {
  const invalidate = useInvalidateOrg();
  const [form, setForm] = useState<ArrangementFormValues>(() =>
    arrangement ? arrangementFormFrom(arrangement) : newArrangementForm(song),
  );

  useEffect(() => {
    if (open) setForm(arrangement ? arrangementFormFrom(arrangement) : newArrangementForm(song));
  }, [open, arrangement, song]);

  const update = <K extends keyof ArrangementFormValues>(
    field: K,
    value: ArrangementFormValues[K],
  ) => setForm((current) => ({ ...current, [field]: value }));

  const save = useMutation({
    mutationFn: (): Promise<ArrangementRow> => {
      if (!arrangement) return api.createArrangement(song.id, toCreateArrangementInput(form));

      return api.updateArrangement(arrangement.id, {
        ...toUpdateArrangementInput(form),
        // Only ever promote: sending `false` for the current default would
        // leave the song with none.
        ...(form.isDefault && !arrangement.is_default ? { is_default: true } : {}),
      });
    },
    onSuccess: async (saved) => {
      await invalidate();
      onSaved?.(saved);
      onClose();
    },
  });

  const close = () => {
    if (save.isPending) return;
    save.reset();
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <Modal
      open={open}
      title={arrangement ? 'Edit Arrangement' : 'Add Arrangement'}
      onClose={close}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="arrangement-name">Arrangement Name</label>
          <input
            id="arrangement-name"
            className="input"
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            placeholder="Default Arrangement"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="arrangement-key">Key</label>
            <KeySelect
              id="arrangement-key"
              value={form.songKey}
              onChange={(key) => update('songKey', key)}
              resetLabel="No key"
            />
          </div>
          <div>
            <label className="label" htmlFor="arrangement-capo">Capo</label>
            <select
              id="arrangement-capo"
              className="input"
              value={form.capo ?? ''}
              onChange={(event) =>
                update('capo', event.target.value ? Number(event.target.value) : null)
              }
            >
              <option value="">None</option>
              {CAPO_POSITIONS.map((fret) => (
                <option key={fret} value={fret}>{fret}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label" htmlFor="arrangement-length">Length</label>
            <input
              id="arrangement-length"
              className="input"
              value={form.length}
              onChange={(event) => update('length', event.target.value)}
              placeholder="6:35"
            />
          </div>
          <div>
            <label className="label" htmlFor="arrangement-bpm">BPM</label>
            <input
              id="arrangement-bpm"
              className="input"
              value={form.bpm}
              onChange={(event) => update('bpm', event.target.value)}
              inputMode="numeric"
              placeholder="58"
            />
          </div>
          <div>
            <label className="label" htmlFor="arrangement-meter">Meter</label>
            <input
              id="arrangement-meter"
              className="input"
              value={form.meter}
              onChange={(event) => update('meter', event.target.value)}
              placeholder="4/4"
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="arrangement-sequence">Sequence</label>
          <input
            id="arrangement-sequence"
            className="input"
            value={form.sequence}
            onChange={(event) => update('sequence', event.target.value)}
            placeholder="Intro, V1, C1, V2, C1, B, C2, E"
          />
          <p className="mt-1 text-xs text-slate-500">
            The order the sections are played in, separated by commas.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="size-4 rounded border-slate-300"
            checked={form.isDefault}
            disabled={arrangement?.is_default ?? song.arrangements.length === 0}
            onChange={(event) => update('isDefault', event.target.checked)}
          />
          Use as the default arrangement
        </label>

        <ErrorNotice error={save.error} />

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Submit
          </Button>
        </div>
      </form>
    </Modal>
  );
};
