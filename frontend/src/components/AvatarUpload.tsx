import { useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AVATAR_MIME_TYPES,
  STORAGE_BUCKETS,
  avatarFileProblem,
  avatarObjectPath,
  type AvatarMimeType,
  type AvatarTarget,
  LocalizedError,
} from '@service-center/shared';
import { supabase } from '../lib/supabase';
import { Avatar, Button, ErrorNotice } from './ui';

export interface AvatarUploadProps {
  name: string | null | undefined;
  url: string | null | undefined;
  /** Whose picture: decides the storage folder the bucket policies allow. */
  target: AvatarTarget;
  /** Saves the new public URL (or null to remove it) on the profile or Person. */
  onChange: (url: string | null) => Promise<unknown>;
}

/** A profile picture with upload and remove; the file goes straight to the `avatars` bucket. */
export const AvatarUpload = ({ name, url, target, onChange }: AvatarUploadProps) => {
  const { t } = useTranslation('common');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const problem = avatarFileProblem(file.type, file.size);
    if (problem) {
      setError(new LocalizedError({ key: `common:avatar.problem.${problem}` }));
      return;
    }
    await run(async () => {
      const path = avatarObjectPath(target, crypto.randomUUID(), file.type as AvatarMimeType);
      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKETS.avatars)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from(STORAGE_BUCKETS.avatars).getPublicUrl(path);
      await onChange(data.publicUrl);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={name} url={url} size="lg" />
        <label className="cursor-pointer rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
          {busy ? t('avatar.uploading') : url ? t('avatar.change') : t('avatar.upload')}
          <input
            type="file"
            accept={AVATAR_MIME_TYPES.join(',')}
            className="sr-only"
            disabled={busy}
            onChange={(event) => void upload(event)}
          />
        </label>
        {url && (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void run(() => onChange(null))}>
            {t('avatar.remove')}
          </Button>
        )}
      </div>
      <p className="text-xs text-slate-400">{t('avatar.hint')}</p>
      <ErrorNotice error={error} />
    </div>
  );
};
