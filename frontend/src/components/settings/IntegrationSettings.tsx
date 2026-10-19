import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  API_CREDENTIAL_STATE_LABELS,
  API_SCOPE_LABELS,
  WEBHOOK_DELIVERY_STATUS_LABELS,
  WEBHOOK_DISABLED_REASON_LABELS,
  WEBHOOK_EVENT_LABELS,
  formatDate,
  formatDateTime,
  webhookErrorLabel,
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

/** Shown once after creation: the value cannot be retrieved again. */
interface OneTimeSecretProps {
  label: string;
  value: string;
  onDone: () => void;
}

const OneTimeSecret = ({ label, value, onDone }: OneTimeSecretProps) => {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="space-y-2 rounded-lg bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-600/20">
      <p className="font-medium">{label}</p>
      <p>Copy it now and store it somewhere safe. It will not be shown again.</p>
      <div className="flex gap-2">
        <input className="input min-w-0 flex-1 font-mono text-xs" readOnly value={value} aria-label={label} onFocus={(event) => event.target.select()} />
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <Button variant="ghost" onClick={onDone}>I have stored it</Button>
    </div>
  );
};

interface ToggleListProps<T extends string> {
  legend: string;
  options: readonly T[];
  labels: Record<T, string>;
  selected: T[];
  onChange: (next: T[]) => void;
  /** Rendered as code next to each label (the scope or event name). */
  showValue?: boolean;
}

const ToggleList = <T extends string>({ legend, options, labels, selected, onChange, showValue = true }: ToggleListProps<T>) => (
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
            {labels[option]}
            {showValue && <code className="ml-2 text-xs text-slate-500">{option}</code>}
          </span>
        </label>
      ))}
    </div>
  </fieldset>
);

// ================================================================ credentials

const CredentialRow = ({ credential }: { credential: ApiCredentialSummary }) => {
  const invalidate = useInvalidateIntegrations();
  const revoke = useMutation({ mutationFn: () => api.revokeApiCredential(credential.id), onSuccess: invalidate });
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0 text-sm">
        <p className="font-medium">
          {credential.name} <code className="ml-1 text-xs text-slate-500">sck_{credential.key_prefix}_…</code>
        </p>
        <p className="text-slate-500">
          {credential.scopes.join(', ')} · {credential.rate_limit_per_minute}/min · created {formatDate(credential.created_at)}
          {credential.created_by_name ? ` by ${credential.created_by_name}` : ''}
        </p>
        <p className="text-slate-500">
          {credential.last_used_at ? `Last used ${formatDateTime(credential.last_used_at)}` : 'Never used'}
          {credential.expires_at ? ` · expires ${formatDate(credential.expires_at)}` : ''}
        </p>
        <ErrorNotice error={revoke.error} />
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={credentialTone[credential.state]}>{API_CREDENTIAL_STATE_LABELS[credential.state]}</Badge>
        {credential.state !== 'revoked' && (
          <Button
            variant="secondary"
            loading={revoke.isPending}
            onClick={() => {
              if (window.confirm(`Revoke “${credential.name}”? Integrations using it stop working on their next request.`)) revoke.mutate();
            }}
          >
            Revoke
          </Button>
        )}
      </div>
    </li>
  );
};

const NewCredentialForm = ({ onClose }: { onClose: () => void }) => {
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

  if (secret) return <OneTimeSecret label="New API key" value={secret} onDone={onClose} />;

  return (
    <form
      className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <div>
        <label className="label" htmlFor="api-credential-name">Name</label>
        <input id="api-credential-name" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Lobby display" required maxLength={80} />
      </div>
      <ToggleList legend="Access" options={ALL_SCOPES} labels={API_SCOPE_LABELS} selected={scopes} onChange={setScopes} />
      <div>
        <label className="label" htmlFor="api-credential-expiry">Expires (optional)</label>
        <input id="api-credential-expiry" type="date" className="input" value={expires} onChange={(event) => setExpires(event.target.value)} />
      </div>
      <p className="text-xs text-slate-500">
        Read-only. Keys see published plans, service types and the song library — never people, notes, files or drafts.
        A key stops working if it is revoked, expires, or you stop being an administrator.
      </p>
      <ErrorNotice error={create.error} />
      <div className="flex gap-2">
        <Button type="submit" loading={create.isPending} disabled={!scopes.length || !name.trim()}>Create key</Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
};

// ================================================================== webhooks

const DeliveryRow = ({ delivery }: { delivery: WebhookDeliveryListItem }) => {
  const invalidate = useInvalidateIntegrations();
  const retry = useMutation({ mutationFn: () => api.retryWebhookDelivery(delivery.id), onSuccess: invalidate });
  const last = delivery.history[delivery.history.length - 1];
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
      <div className="min-w-0">
        <p>{WEBHOOK_EVENT_LABELS[delivery.event_type]}</p>
        <p className="text-slate-500">
          {formatDateTime(delivery.occurred_at)} · {delivery.attempts} attempt{delivery.attempts === 1 ? '' : 's'}
          {last?.duration_ms !== null && last?.duration_ms !== undefined ? ` · ${last.duration_ms} ms` : ''}
          {delivery.status === 'queued' && delivery.attempts > 0 ? ` · next try ${formatDateTime(delivery.next_attempt_at)}` : ''}
        </p>
        {delivery.last_error_code && <p className="text-slate-500">{webhookErrorLabel(delivery.last_error_code)}</p>}
        <p className="font-mono text-xs text-slate-400">evt_{delivery.event_id.replace(/-/g, '')}</p>
        <ErrorNotice error={retry.error} />
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={deliveryTone[delivery.status]}>{WEBHOOK_DELIVERY_STATUS_LABELS[delivery.status]}</Badge>
        {delivery.retryable && (
          <Button variant="secondary" loading={retry.isPending} onClick={() => retry.mutate()}>Retry</Button>
        )}
      </div>
    </li>
  );
};

const EndpointRow = ({ endpoint }: { endpoint: WebhookEndpointSummary }) => {
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
    ? { label: 'Revoked', tone: NEUTRAL }
    : endpoint.enabled
      ? { label: 'Active', tone: POSITIVE }
      : { label: endpoint.disabled_reason ? WEBHOOK_DISABLED_REASON_LABELS[endpoint.disabled_reason] : 'Paused', tone: WARNING };

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className="break-all font-medium">{endpoint.url}</p>
          {endpoint.description && <p className="text-slate-500">{endpoint.description}</p>}
          <p className="text-slate-500">
            {endpoint.event_types.join(', ')} · secret …{endpoint.secret_hint}
            {endpoint.pending_deliveries ? ` · ${endpoint.pending_deliveries} waiting` : ''}
            {endpoint.failed_deliveries ? ` · ${endpoint.failed_deliveries} failed` : ''}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="ghost" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? 'Hide deliveries' : 'Deliveries'}
        </Button>
        {!revoked && (
          <>
            <Button variant="secondary" loading={test.isPending} disabled={!endpoint.enabled} onClick={() => test.mutate()}>Send test</Button>
            <Button variant="secondary" loading={toggle.isPending} onClick={() => toggle.mutate()}>
              {endpoint.enabled ? 'Pause' : 'Resume'}
            </Button>
            <Button
              variant="secondary"
              loading={revoke.isPending}
              onClick={() => {
                if (window.confirm('Revoke this endpoint? It receives nothing further; its delivery history is kept.')) revoke.mutate();
              }}
            >
              Revoke
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
            <p className="py-4 text-center text-sm text-slate-400">Nothing has been sent to this endpoint yet.</p>
          )}
          <ErrorNotice error={deliveries.error} />
        </div>
      )}
    </li>
  );
};

const NewEndpointForm = ({ onClose }: { onClose: () => void }) => {
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

  if (secret) return <OneTimeSecret label="Signing secret" value={secret} onDone={onClose} />;

  return (
    <form
      className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <div>
        <label className="label" htmlFor="webhook-url">Endpoint URL</label>
        <input id="webhook-url" type="url" className="input" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/hooks/service-center" required />
      </div>
      <div>
        <label className="label" htmlFor="webhook-description">Description (optional)</label>
        <input id="webhook-description" className="input" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={200} />
      </div>
      <ToggleList legend="Events" options={ALL_EVENTS} labels={WEBHOOK_EVENT_LABELS} selected={events} onChange={setEvents} />
      <p className="text-xs text-slate-500">
        Events carry only ids; the receiver reads details with an API key. Requests are signed (Standard Webhooks) and
        retried with the same event id, so receivers should verify the signature and ignore ids they have seen.
      </p>
      <ErrorNotice error={create.error} />
      <div className="flex gap-2">
        <Button type="submit" loading={create.isPending} disabled={!events.length || !url}>Add endpoint</Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
};

/**
 * Administrator view (F17): read-only API keys for approved integrations and
 * signed webhooks for plan publication changes, with delivery outcomes.
 */
export const IntegrationSettings = () => {
  const status = useIntegrationStatus();
  const credentials = useApiCredentials();
  const endpoints = useWebhookEndpoints();
  const [creatingKey, setCreatingKey] = useState(false);
  const [creatingEndpoint, setCreatingEndpoint] = useState(false);

  return (
    <section className="card space-y-6 p-5">
      <div>
        <h2 className="mb-1 font-semibold">Developer API and webhooks</h2>
        <p className="text-sm text-slate-500">
          Let an approved integration read published plans and songs, and tell it when plans are published.
          {status.data && (
            <>
              {' '}API base URL <code className="break-all text-xs">{status.data.api_base_url}</code> (version {status.data.api_version}).
            </>
          )}
        </p>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">API keys</h3>
          {!creatingKey && <Button variant="secondary" onClick={() => setCreatingKey(true)}>New key</Button>}
        </div>
        {creatingKey && <NewCredentialForm onClose={() => setCreatingKey(false)} />}
        {credentials.isLoading ? (
          <div className="flex justify-center py-4 text-slate-400"><Spinner /></div>
        ) : credentials.data?.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {credentials.data.map((credential) => <CredentialRow key={credential.id} credential={credential} />)}
          </ul>
        ) : (
          !creatingKey && <p className="rounded-lg bg-slate-50 px-4 py-4 text-center text-sm text-slate-400 dark:bg-slate-900/40">No API keys yet.</p>
        )}
        <ErrorNotice error={credentials.error} />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Webhooks</h3>
          {!creatingEndpoint && status.data?.webhooks_available && (
            <Button variant="secondary" onClick={() => setCreatingEndpoint(true)}>Add endpoint</Button>
          )}
        </div>
        {status.data && !status.data.webhooks_available && (
          <p className="mb-2 text-sm text-amber-700">
            Webhooks are not available: the server has no secret-encryption key configured.
          </p>
        )}
        {status.data && !status.data.worker_configured && (
          <p className="mb-2 text-sm text-amber-700">
            No scheduled worker is configured, so webhook deliveries wait until an operator runs the worker.
          </p>
        )}
        {creatingEndpoint && <NewEndpointForm onClose={() => setCreatingEndpoint(false)} />}
        {endpoints.isLoading ? (
          <div className="flex justify-center py-4 text-slate-400"><Spinner /></div>
        ) : endpoints.data?.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {endpoints.data.map((endpoint) => <EndpointRow key={endpoint.id} endpoint={endpoint} />)}
          </ul>
        ) : (
          !creatingEndpoint && <p className="rounded-lg bg-slate-50 px-4 py-4 text-center text-sm text-slate-400 dark:bg-slate-900/40">No webhook endpoints yet.</p>
        )}
        <ErrorNotice error={status.error ?? endpoints.error} />
      </div>
    </section>
  );
};
