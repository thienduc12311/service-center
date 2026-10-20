import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { type FileCategory, type FilePlaybackRights, type FileSummary } from '@service-center/shared';
import { api } from '../../lib/api';
import { Button, Modal } from '../ui';
import { AudienceFields, type FileAudienceValue } from './AudienceFields';
import { FILE_CATEGORIES, fileErrorMessage } from './fileActions';

export interface FileDetailsModalProps {
  file: FileSummary;
  planId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Title, category, audience and (for links) the address. Saved against the revision it was opened at. */
export const FileDetailsModal = ({ file, planId = null, onClose, onSaved }: FileDetailsModalProps) => {
  const { t } = useTranslation(['media', 'common']);
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
    <Modal open title={t('details.title')} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <label className="block">
          <span className="label">{t('addFile.title')}</span>
          <input className="input" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        {file.kind === 'link' && (
          <label className="block">
            <span className="label">{t('addFile.url')}</span>
            <input className="input" type="url" required value={url} onChange={(event) => setUrl(event.target.value)} />
          </label>
        )}
        <label className="block">
          <span className="label">{t('files.category')}</span>
          <select className="input" value={category} onChange={(event) => setCategory(event.target.value as FileCategory)}>
            {FILE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(`files.categories.${value}`)}
              </option>
            ))}
          </select>
        </label>
        {file.kind === 'upload' && (
          <label className="block">
            <span className="label">{t('details.rights')}</span>
            <select className="input" value={rights} onChange={(event) => setRights(event.target.value as FilePlaybackRights)}>
              <option value="download">{t('details.rightsOptions.download')}</option>
              <option value="stream_only">{t('details.rightsOptions.stream_only')}</option>
            </select>
            {rights === 'stream_only' && (
              <span className="mt-1 block text-xs text-slate-500">{t('details.streamOnlyHint')}</span>
            )}
          </label>
        )}
        <AudienceFields ownerKind={file.owner.kind} planId={planId} value={audience} onChange={setAudience} />
        {narrowing && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-600/20">
            {t('details.narrowingHint')}
          </p>
        )}
        {save.error && (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-600/20">
            {fileErrorMessage(save.error)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            type="submit"
            loading={save.isPending}
            disabled={
              (audience.audience === 'teams' && !audience.teamIds.length) ||
              (audience.audience === 'positions' && !audience.positionIds.length)
            }
          >
            {t('common:actions.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
