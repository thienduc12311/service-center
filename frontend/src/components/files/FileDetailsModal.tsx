import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FILE_CATEGORY_LABELS, type FileCategory, type FilePlaybackRights, type FileSummary } from '@service-center/shared';
import { api } from '../../lib/api';
import { Button, Modal } from '../ui';
import { AudienceFields, type FileAudienceValue } from './AudienceFields';
import { fileErrorMessage } from './fileActions';

export interface FileDetailsModalProps {
  file: FileSummary;
  planId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Title, category, audience and (for links) the address. Saved against the revision it was opened at. */
export const FileDetailsModal = ({ file, planId = null, onClose, onSaved }: FileDetailsModalProps) => {
  const [title, setTitle] = useState(file.title);
  const [category, setCategory] = useState<FileCategory>(file.category);
  const [url, setUrl] = useState(file.external_url ?? '');
  const [rights, setRights] = useState<FilePlaybackRights>(file.playback_rights);
  const [audience, setAudience] = useState<FileAudienceValue>({
    audience: file.audience,
    teamIds: file.audience_targets.flatMap((target) => (target.team_id ? [target.team_id] : [])),
    positionIds: file.audience_targets.flatMap((target) => (target.position_id ? [target.position_id] : [])),
  });

  const save = useMutation({
    mutationFn: async () => {
      let revision = file.revision;
      if (file.kind === 'link' && url.trim() !== file.external_url) {
        revision = (await api.updateFileLinkUrl(file.id, { title: title.trim(), url: url.trim(), expected_revision: revision })).revision;
      }
      const saved = await api.updateFile(file.id, {
        title: title.trim(),
        category,
        audience: audience.audience,
        team_ids: audience.teamIds,
        position_ids: audience.positionIds,
        expected_revision: revision,
      });
      if (file.kind === 'upload' && rights !== file.playback_rights) {
        return api.setFilePlaybackRights(file.id, { playback_rights: rights, expected_revision: saved.revision });
      }
      return saved;
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: () => onSaved(),
  });

  const narrowing = audience.audience !== file.audience;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <Modal open title="File details" onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <label className="block">
          <span className="label">Title</span>
          <input className="input" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        {file.kind === 'link' && (
          <label className="block">
            <span className="label">Web address</span>
            <input className="input" type="url" required value={url} onChange={(event) => setUrl(event.target.value)} />
          </label>
        )}
        <label className="block">
          <span className="label">Category</span>
          <select className="input" value={category} onChange={(event) => setCategory(event.target.value as FileCategory)}>
            {Object.entries(FILE_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {file.kind === 'upload' && (
          <label className="block">
            <span className="label">Readers may</span>
            <select className="input" value={rights} onChange={(event) => setRights(event.target.value as FilePlaybackRights)}>
              <option value="download">Play, open and download</option>
              <option value="stream_only">Play and open only (no download or offline copy)</option>
            </select>
            {rights === 'stream_only' && (
              <span className="mt-1 block text-xs text-slate-500">
                Download buttons and offline packs leave this file out. Anything a browser plays can still be recorded, so
                this is not copy protection.
              </span>
            )}
          </label>
        )}
        <AudienceFields ownerKind={file.owner.kind} planId={planId} value={audience} onChange={setAudience} />
        {narrowing && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-600/20">
            The new audience applies to every version and to plans that use this file. Links already opened stay valid for a
            few minutes, and copies people downloaded cannot be recalled.
          </p>
        )}
        {save.error && (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-600/20">
            {fileErrorMessage(save.error)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={save.isPending}
            disabled={
              (audience.audience === 'teams' && !audience.teamIds.length) ||
              (audience.audience === 'positions' && !audience.positionIds.length)
            }
          >
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
};
