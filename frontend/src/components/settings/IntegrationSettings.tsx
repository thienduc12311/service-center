import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  type ApiCredentialState,
  type ApiCredentialSummary,
  type ApiScope,
  type WebhookDeliveryListItem,
  type WebhookDeliveryStatus,
  type WebhookEndpointSummary,
  type WebhookEventType,
} from '@service-center/shared';
import { api } from '../../lib/api';
import {
  useApiCredentials,
  useIntegrationStatus,
  useInvalidateIntegrations,
  useWebhookDeliveries,
  useWebhookEndpoints,
} from '../../hooks/queries';
import { Badge, Button, ErrorNotice, Spinner } from '../ui';
import { useFormatters } from '../../i18n';

const POSITIVE = 'bg-emerald-50 text-emerald-700 ring-emerald-600/20';
const NEUTRAL = 'bg-slate-100 text-slate-600 ring-slate-500/20';
const WARNING = 'bg-amber-50 text-amber-800 ring-amber-600/20';
const NEGATIVE = 'bg-red-50 text-red-700 ring-red-600/20';

const credentialTone: Record<ApiCredentialState, string> = {
  active: POSITIVE,
  revoked: NEUTRAL,
  expired: NEUTRAL,
  issuer_inactive: WARNING,
};

const deliveryTone: Record<WebhookDeliveryStatus, string> = {
  queued: NEUTRAL,
  sending: NEUTRAL,
  succeeded: POSITIVE,
  failed: NEGATIVE,
  cancelled: NEUTRAL,
};

const ALL_SCOPES: ApiScope[] = ['plans.read', 'songs.read'];
const ALL_EVENTS: WebhookEventType[] = ['plan.published', 'plan.unpublished', 'plan.deleted'];

/** Stored webhook delivery error codes that have a translated explanation. */
const KNOWN_WEBHOOK_ERRORS = [
  'timeout',
  'destination_blocked',
  'dns_failed',
  'connection_failed',
  'redirect_not_followed',
  'secret_unavailable',
  'endpoint_disabled',
  'endpoint_revoked',
] as const;
type KnownWebhookError = (typeof KNOWN_WEBHOOK_ERRORS)[number];

const isKnownWebhookError = (code: string): code is KnownWebhookError =>
  (KNOWN_WEBHOOK_ERRORS as readonly string[]).includes(code);

/** Human text for a stored delivery error code (`http_503` → "Endpoint answered HTTP 503"); unknown codes stay as-is. */
const webhookErrorText = (t: TFunction<'settings'>, code: string): string => {
  const http = /^http_(\d{3})$/.exec(code);
  if (http) return t('integrations.webhookError.http', { status: http[1] });
  return isKnownWebhookError(code) ? t(`integrations.webhookError.${code}`) : code;
};

/** Shown once after creation: the value cannot be retrieved again. */
interface OneTimeSecretProps {
  label: string;
  value: string;
  onDone: () => void;
}

const OneTimeSecret = ({ label, value, onDone }: OneTimeSecretProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="space-y-2 rounded-lg bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-600/20">
      <p className="font-medium">{label}</p>
      <p>{t('integrations.secretOnce')}</p>
      <div className="flex gap-2">
        <input className="input min-w-0 flex-1 font-mono text-xs" readOnly value={value} aria-label={label} onFocus={(event) => event.target.select()} />
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => setCopied(true));
          }}
        >
          {copied ? t('common:actions.copied') : t('common:actions.copy')}
        </Button>
      </div>
      <Button variant="ghost" onClick={onDone}>{t('integrations.secretStored')}</Button>
    </div>
  );
};

interface ToggleListProps<T extends string> {
  legend: string;
  options: readonly T[];
  /** Translated description of one option. */
  labelOf: (option: T) => string;
  selected: T[];
  onChange: (next: T[]) => void;
  /** Rendered as code next to each label (the scope or event name). */
  showValue?: boolean;
}

const ToggleList = <T extends string>({ legend, options, labelOf, selected, onChange, showValue = true }: ToggleListProps<T>) => (
  <fieldset>
    <legend className="label">{legend}</legend>
    <div className="space-y-1">
      {options.map((option) => (
        <label key={option} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={selected.includes(option)}
            onChange={(event) => onChange(event.target.checked ? [...selected, option] : selected.filter((value) => value !== option))}
          />
          <span>
            {labelOf(option)}
            {showValue && <code className="ml-2 text-xs text-slate-500">{option}</code>}
          </span>
        </label>
      ))}
    </div>
  </fieldset>
);

// ================================================================ credentials

const CredentialRow = ({ credential }: { credential: ApiCredentialSummary }) => {
  const { t } = useTranslation('settings');
  const { date, dateTime } = useFormatters();
  const invalidate = useInvalidateIntegrations();
  const revoke = useMutation({ mutationFn: () => api.revokeApiCredential(credential.id), onSuccess: invalidate });
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0 text-sm">
        <p className="font-medium">
          {credential.name} <code className="ml-1 text-xs text-slate-500">sck_{credential.key_prefix}_…</code>
        </p>
        <p className="text-slate-500">
          {credential.created_by_name
            ? t('integrations.credentialMetaBy', {
                scopes: credential.scopes.join(', '),
                rate: credential.rate_limit_per_minute,
                date: date(credential.created_at),
                name: credential.created_by_name,
              })
            : t('integrations.credentialMeta', {
                scopes: credential.scopes.join(', '),
                rate: credential.rate_limit_per_minute,
                date: date(credential.created_at),
              })}
        </p>
        <p className="text-slate-500">
          {credential.last_used_at ? t('integrations.lastUsed', { when: dateTime(credential.last_used_at) }) : t('integrations.neverUsed')}
          {credential.expires_at ? ` · ${t('integrations.expires', { date: date(credential.expires_at) })}` : ''}
        </p>
        <ErrorNotice error={revoke.error} />
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={credentialTone[credential.state]}>{t(`integrations.credentialState.${credential.state}`)}</Badge>
        {credential.state !== 'revoked' && (
          <Button
            variant="secondary"
            loading={revoke.isPending}
            onClick={() => {
              if (window.confirm(t('integrations.revokeKeyConfirm', { name: credential.name }))) revoke.mutate();
            }}
          >
            {t('integrations.revoke')}
          </Button>
        )}
      </div>
    </li>
  );
};

const NewCredentialForm = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation(['settings', 'common']);
  const invalidate = useInvalidateIntegrations();
  // One key per form: a double submit or network retry returns the same credential.
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>(['plans.read']);
  const [expires, setExpires] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api.createApiCredential({
        name,
        scopes,
        expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
        idempotency_key: requestKey,
      }),
    onSuccess: (result) => {
      void invalidate();
      setSecret(result.secret);
      setRequestKey(crypto.randomUUID());
      if (!result.secret) onClose();
    },
  });

  if (secret) return <OneTimeSecret label={t('integrations.newKeySecret')} value={secret} onDone={onClose} />;

  return (
    <form
      className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <div>
        <label className="label" htmlFor="api-credential-name">{t('integrations.keyName')}</label>
        <input id="api-credential-name" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('integrations.keyNamePlaceholder')} required maxLength={80} />
      </div>
      <ToggleList legend={t('integrations.keyAccess')} options={ALL_SCOPES} labelOf={(scope) => t(`integrations.scope.${scope}`)} selected={scopes} onChange={setScopes} />
      <div>
        <label className="label" htmlFor="api-credential-expiry">{t('integrations.keyExpires')}</label>
        <input id="api-credential-expiry" type="date" className="input" value={expires} onChange={(event) => setExpires(event.target.value)} />
      </div>
      <p className="text-xs text-slate-500">{t('integrations.keyHint')}</p>
      <ErrorNotice error={create.error} />
      <div className="flex gap-2">
        <Button type="submit" loading={create.isPending} disabled={!scopes.length || !name.trim()}>{t('integrations.createKey')}</Button>
        <Button variant="ghost" onClick={onClose}>{t('common:actions.cancel')}</Button>
      </div>
    </form>
  );
};

// ================================================================== webhooks

const DeliveryRow = ({ delivery }: { delivery: WebhookDeliveryListItem }) => {
  const { t } = useTranslation('settings');
  const { dateTime } = useFormatters();
  const invalidate = useInvalidateIntegrations();
  const retry = useMutation({ mutationFn: () => api.retryWebhookDelivery(delivery.id), onSuccess: invalidate });
  const last = delivery.history[delivery.history.length - 1];
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
      <div className="min-w-0">
        <p>{t(`integrations.event.${delivery.event_type}`)}</p>
        <p className="text-slate-500">
          {[
            dateTime(delivery.occurred_at),
            t('integrations.attempts', { count: delivery.attempts }),
            last?.duration_ms !== null && last?.duration_ms !== undefined ? t('integrations.durationMs', { ms: last.duration_ms }) : null,
            delivery.status === 'queued' && delivery.attempts > 0 ? t('integrations.nextTry', { when: dateTime(delivery.next_attempt_at) }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {delivery.last_error_code && <p className="text-slate-500">{webhookErrorText(t, delivery.last_error_code)}</p>}
        <p className="font-mono text-xs text-slate-400">evt_{delivery.event_id.replace(/-/g, '')}</p>
        <ErrorNotice error={retry.error} />
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={deliveryTone[delivery.status]}>{t(`integrations.deliveryStatus.${delivery.status}`)}</Badge>
        {delivery.retryable && (
          <Button variant="secondary" loading={retry.isPending} onClick={() => retry.mutate()}>{t('delivery.retry')}</Button>
        )}
      </div>
    </li>
  );
};

const EndpointRow = ({ endpoint }: { endpoint: WebhookEndpointSummary }) => {
  const { t } = useTranslation('settings');
  const invalidate = useInvalidateIntegrations();
  const [open, setOpen] = useState(false);
  const deliveries = useWebhookDeliveries(endpoint.id, open);
  const revoked = Boolean(endpoint.revoked_at);
  const toggle = useMutation({
    mutationFn: () => api.setWebhookEndpointEnabled(endpoint.id, { enabled: !endpoint.enabled, expected_revision: endpoint.revision }),
    onSettled: invalidate,
  });
  const test = useMutation({
    mutationFn: () => api.sendWebhookTest(endpoint.id),
    onSuccess: () => {
      setOpen(true);
      void invalidate();
    },
  });
  const revoke = useMutation({ mutationFn: () => api.revokeWebhookEndpoint(endpoint.id), onSuccess: invalidate });

  const status = revoked
    ? { label: t('integrations.endpointState.revoked'), tone: NEUTRAL }
    : endpoint.enabled
      ? { label: t('integrations.endpointState.active'), tone: POSITIVE }
      : {
          label: endpoint.disabled_reason
            ? t(`integrations.disabledReason.${endpoint.disabled_reason}`)
            : t('integrations.endpointState.paused'),
          tone: WARNING,
        };

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className="break-all font-medium">{endpoint.url}</p>
          {endpoint.description && <p className="text-slate-500">{endpoint.description}</p>}
          <p className="text-slate-500">
            {[
              endpoint.event_types.join(', '),
              t('integrations.secretHint', { hint: endpoint.secret_hint }),
              endpoint.pending_deliveries ? t('integrations.waitingCount', { count: endpoint.pending_deliveries }) : null,
              endpoint.failed_deliveries ? t('integrations.failedCount', { count: endpoint.failed_deliveries }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="ghost" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? t('integrations.hideDeliveries') : t('integrations.deliveries')}
        </Button>
        {!revoked && (
          <>
            <Button variant="secondary" loading={test.isPending} disabled={!endpoint.enabled} onClick={() => test.mutate()}>{t('integrations.sendTest')}</Button>
            <Button variant="secondary" loading={toggle.isPending} onClick={() => toggle.mutate()}>
              {endpoint.enabled ? t('integrations.pause') : t('integrations.resume')}
            </Button>
            <Button
              variant="secondary"
              loading={revoke.isPending}
              onClick={() => {
                if (window.confirm(t('integrations.revokeEndpointConfirm'))) revoke.mutate();
              }}
            >
              {t('integrations.revoke')}
            </Button>
          </>
        )}
      </div>
      <ErrorNotice error={toggle.error ?? test.error ?? revoke.error} />
      {open && (
        <div className="mt-2 rounded-lg bg-slate-50 px-3 dark:bg-slate-900/40">
          {deliveries.isLoading ? (
            <div className="flex justify-center py-4 text-slate-400"><Spinner /></div>
          ) : deliveries.data?.length ? (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {deliveries.data.map((delivery) => <DeliveryRow key={delivery.id} delivery={delivery} />)}
            </ul>
          ) : (
            <p className="py-4 text-center text-sm text-slate-400">{t('integrations.noDeliveries')}</p>
          )}
          <ErrorNotice error={deliveries.error} />
        </div>
      )}
    </li>
  );
};

const NewEndpointForm = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation(['settings', 'common']);
  const invalidate = useInvalidateIntegrations();
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<WebhookEventType[]>([...ALL_EVENTS]);
  const [secret, setSecret] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.createWebhookEndpoint({ url, description: description || null, event_types: events, idempotency_key: requestKey }),
    onSuccess: (result) => {
      void invalidate();
      setSecret(result.signing_secret);
      setRequestKey(crypto.randomUUID());
      if (!result.signing_secret) onClose();
    },
  });

  if (secret) return <OneTimeSecret label={t('integrations.signingSecret')} value={secret} onDone={onClose} />;

  return (
    <form
      className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <div>
        <label className="label" htmlFor="webhook-url">{t('integrations.endpointUrl')}</label>
        <input id="webhook-url" type="url" className="input" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/hooks/service-center" required />
      </div>
      <div>
        <label className="label" htmlFor="webhook-description">{t('integrations.endpointDescription')}</label>
        <input id="webhook-description" className="input" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={200} />
      </div>
      <ToggleList legend={t('integrations.events')} options={ALL_EVENTS} labelOf={(event) => t(`integrations.event.${event}`)} selected={events} onChange={setEvents} />
      <p className="text-xs text-slate-500">{t('integrations.endpointHint')}</p>
      <ErrorNotice error={create.error} />
      <div className="flex gap-2">
        <Button type="submit" loading={create.isPending} disabled={!events.length || !url}>{t('integrations.addEndpoint')}</Button>
        <Button variant="ghost" onClick={onClose}>{t('common:actions.cancel')}</Button>
      </div>
    </form>
  );
};

/**
 * Administrator view (F17): read-only API keys for approved integrations and
 * signed webhooks for plan publication changes, with delivery outcomes.
 */
export const IntegrationSettings = () => {
  const { t } = useTranslation('settings');
  const status = useIntegrationStatus();
  const credentials = useApiCredentials();
  const endpoints = useWebhookEndpoints();
  const [creatingKey, setCreatingKey] = useState(false);
  const [creatingEndpoint, setCreatingEndpoint] = useState(false);

  return (
    <section className="card space-y-6 p-5">
      <div>
        <h2 className="mb-1 font-semibold">{t('integrations.title')}</h2>
        <p className="text-sm text-slate-500">
          {t('integrations.description')}
          {status.data && (
            <>
              {' '}
              <Trans
                t={t}
                i18nKey="integrations.baseUrl"
                values={{ url: status.data.api_base_url, version: status.data.api_version }}
                components={[<code key="url" className="break-all text-xs" />]}
              />
            </>
          )}
        </p>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t('integrations.apiKeys')}</h3>
          {!creatingKey && <Button variant="secondary" onClick={() => setCreatingKey(true)}>{t('integrations.newKey')}</Button>}
        </div>
        {creatingKey && <NewCredentialForm onClose={() => setCreatingKey(false)} />}
        {credentials.isLoading ? (
          <div className="flex justify-center py-4 text-slate-400"><Spinner /></div>
        ) : credentials.data?.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {credentials.data.map((credential) => <CredentialRow key={credential.id} credential={credential} />)}
          </ul>
        ) : (
          !creatingKey && <p className="rounded-lg bg-slate-50 px-4 py-4 text-center text-sm text-slate-400 dark:bg-slate-900/40">{t('integrations.noKeys')}</p>
        )}
        <ErrorNotice error={credentials.error} />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t('integrations.webhooks')}</h3>
          {!creatingEndpoint && status.data?.webhooks_available && (
            <Button variant="secondary" onClick={() => setCreatingEndpoint(true)}>{t('integrations.addEndpoint')}</Button>
          )}
        </div>
        {status.data && !status.data.webhooks_available && (
          <p className="mb-2 text-sm text-amber-700">{t('integrations.webhooksUnavailable')}</p>
        )}
        {status.data && !status.data.worker_configured && (
          <p className="mb-2 text-sm text-amber-700">{t('integrations.noWorker')}</p>
        )}
        {creatingEndpoint && <NewEndpointForm onClose={() => setCreatingEndpoint(false)} />}
        {endpoints.isLoading ? (
          <div className="flex justify-center py-4 text-slate-400"><Spinner /></div>
        ) : endpoints.data?.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {endpoints.data.map((endpoint) => <EndpointRow key={endpoint.id} endpoint={endpoint} />)}
          </ul>
        ) : (
          !creatingEndpoint && <p className="rounded-lg bg-slate-50 px-4 py-4 text-center text-sm text-slate-400 dark:bg-slate-900/40">{t('integrations.noEndpoints')}</p>

        )}
        <ErrorNotice error={status.error ?? endpoints.error} />
      </div>
    </section>
  );
};
