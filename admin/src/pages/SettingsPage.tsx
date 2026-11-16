import { useState, type FormEvent } from 'react';
import { formatFileSize, updatePlatformSettingsSchema, type PlatformSettings, type UpdatePlatformSettingsInput } from '@service-center/shared';
import { usePlatformSettings, useUpdatePlatformSettings } from '../hooks/queries';
import { formatDateTime } from '../lib/format';
import { megabytesFieldValue, quotaBytesFromInput } from '../lib/units';
import { Button, Card, ErrorNotice, Loading, Notice, PageHeader, TextField } from '../components/ui';

export const SettingsPage = () => {
  const settings = usePlatformSettings();
  return (
    <>
      <PageHeader title="Settings" subtitle="Platform-wide defaults for every church." />
      {settings.isPending ? (
        <Loading />
      ) : settings.isError ? (
        <ErrorNotice error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <SettingsForm settings={settings.data} />
      )}
    </>
  );
};

type SaveResult = 'saved' | 'unchanged';

interface SettingsFormProps {
  settings: PlatformSettings;
}

/** Starts from the loaded settings; this page is the only place that changes them. */
const SettingsForm = ({ settings }: SettingsFormProps) => {
  const update = useUpdatePlatformSettings();
  const [quota, setQuota] = useState(() => megabytesFieldValue(settings.default_storage_quota_bytes));
  const [selfServe, setSelfServe] = useState(settings.allow_self_serve_church_creation);
  const [quotaError, setQuotaError] = useState<string | undefined>();
  const [result, setResult] = useState<SaveResult | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setResult(null);
    const quotaResult = quotaBytesFromInput(quota);
    if (!quotaResult.ok) {
      setQuotaError(quotaResult.message);
      return;
    }
    setQuotaError(undefined);
    const changes: UpdatePlatformSettingsInput = {};
    if (quotaResult.bytes !== settings.default_storage_quota_bytes) changes.default_storage_quota_bytes = quotaResult.bytes;
    if (selfServe !== settings.allow_self_serve_church_creation) changes.allow_self_serve_church_creation = selfServe;
    if (!updatePlatformSettingsSchema.safeParse(changes).success) {
      // Nothing changed: the schema wants at least one setting.
      setResult('unchanged');
      return;
    }
    update.mutate(changes, { onSuccess: () => setResult('saved') });
  };

  return (
    <form onSubmit={submit} noValidate className="max-w-2xl space-y-6">
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Default storage quota</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Media storage for every church without a custom quota. Now {formatFileSize(settings.default_storage_quota_bytes)}.
        </p>
        <TextField
          label="Default quota (MB)"
          inputMode="decimal"
          value={quota}
          onChange={(event) => setQuota(event.target.value)}
          error={quotaError}
          className="max-w-xs"
        />
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Church creation</h2>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            role="switch"
            aria-checked={selfServe}
            checked={selfServe}
            onChange={(event) => setSelfServe(event.target.checked)}
            className="mt-0.5 size-4 rounded accent-brand-600"
          />
          <span>
            <span className="font-medium text-slate-900 dark:text-white">Let people create churches without approval</span>
            <span className="block text-slate-500 dark:text-slate-400">
              Off: people apply for a church and a super admin approves it. On: the app offers "New church" again.
            </span>
          </span>
        </label>
        {selfServe && (
          <Notice tone="warning">
            Anyone signed in to Service Center will be able to create a church, with no review.
          </Notice>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={update.isPending}>
          Save settings
        </Button>
        <p className="text-xs text-slate-500 dark:text-slate-400">Last changed {formatDateTime(settings.updated_at)}</p>
      </div>
      {result && !update.isPending && (
        <Notice tone={result === 'saved' ? 'success' : 'info'}>{result === 'saved' ? 'Settings saved.' : 'No changes to save.'}</Notice>
      )}
      <ErrorNotice error={update.error} />
    </form>
  );
};
