import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  ApiError,
  MESSAGE_AUDIENCE_INCLUDE_LABELS,
  MESSAGE_AUDIENCE_REASON_LABELS,
  MESSAGE_TEMPLATE_VARIABLES,
  MESSAGE_VARIABLE_LABELS,
  messageVariableValues,
  renderMessageTemplate,
  unknownMessageVariables,
  type MessageAudienceInclude,
  type MessageAudiencePreview,
  type SendOperationalMessageResult,
  type TeamWithPositions,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg, useMessageTemplates } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Badge, Button, ErrorNotice, Modal } from '../ui';

export interface MessageComposerPlan {
  id: string;
  title: string;
  service_date: string;
  service_type_id: string | null;
}

export interface MessageComposerModalProps {
  /** Message people on this plan; omit for a team-members message. */
  plan: MessageComposerPlan | null;
  /** Teams the sender schedules or manages (the server rechecks). */
  teams: TeamWithPositions[];
  onClose: () => void;
}

const PLAN_GROUPS: MessageAudienceInclude[] = ['scheduled_confirmed', 'scheduled_pending', 'signups', 'team_members'];

/**
 * Choose → preview → write → explicit Send. Preview sends nothing. The send
 * carries the previewed audience version; if the audience changed in the
 * meantime the server refuses and the preview is refreshed for review. One
 * idempotency key per composed message, so a retried Send is one message.
 */
export const MessageComposerModal = ({ plan, teams, onClose }: MessageComposerModalProps) => {
  const invalidate = useInvalidateOrg();
  const { user, organizationId } = useAuth();
  const templates = useMessageTemplates();
  const sendKey = useRef<string>(`message-${crypto.randomUUID()}`);

  const [include, setInclude] = useState<MessageAudienceInclude[]>(plan ? ['scheduled_confirmed', 'scheduled_pending'] : ['team_members']);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<MessageAudiencePreview | null>(null);
  const [staleNotice, setStaleNotice] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sent, setSent] = useState<SendOperationalMessageResult | null>(null);

  const audience = useMemo(
    () => ({ plan_id: plan?.id ?? null, team_ids: teamIds, include }),
    [plan, teamIds, include],
  );
  const audienceInvalid = include.length === 0 || (include.includes('team_members') && teamIds.length === 0);

  const runPreview = useMutation({
    mutationFn: () => api.previewMessage({ audience }),
    onSuccess: (result) => {
      setPreview(result);
      setExcluded((current) => current.filter((id) => result.recipients.some((r) => r.person_id === id)));
    },
  });

  const send = useMutation({
    mutationFn: () => api.sendMessage({
      audience,
      subject,
      body,
      template_id: templateId,
      excluded_person_ids: excluded,
      audience_hash: preview!.audience_hash,
      idempotency_key: sendKey.current,
    }),
    onSuccess: async (result) => {
      setSent(result);
      await invalidate();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'audience_changed') {
        setStaleNotice(true);
        setPreview(null);
        runPreview.mutate();
      }
    },
  });

  const changeAudience = (update: () => void) => {
    update();
    setPreview(null);
    setStaleNotice(false);
  };
  const toggle = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const reachable = (preview?.recipients ?? []).filter((r) => r.reachable && !excluded.includes(r.person_id));
  const unknown = unknownMessageVariables(`${subject} ${body}`);
  const sample = reachable[0];
  const sampleValues = sample
    ? messageVariableValues(sample, {
        organization_name: user?.memberships.find((m) => m.organization.id === organizationId)?.organization.name ?? null,
        organization_timezone: user?.memberships.find((m) => m.organization.id === organizationId)?.organization.timezone ?? null,
        plan_title: plan?.title ?? null,
        plan_date: plan?.service_date ?? null,
        sender_name: user?.profile.full_name ?? null,
      })
    : null;

  const applyTemplate = (id: string) => {
    const template = templates.data?.templates.find((t) => t.id === id);
    setTemplateId(template?.id ?? null);
    if (template) {
      setSubject(template.subject);
      setBody(template.body);
    }
  };

  const saveTemplate = useMutation({
    mutationFn: (shared: boolean) => {
      const name = window.prompt('Template name');
      if (!name) return Promise.resolve(null);
      return api.createMessageTemplate({ name, subject, body, shared });
    },
    onSuccess: (template) => {
      if (template) setTemplateId(template.id);
      return invalidate();
    },
  });

  if (sent) {
    return (
      <Modal open title="Message sent" onClose={onClose}>
        <p className="text-sm text-slate-600">
          {sent.replayed ? 'This message had already been sent; nothing was sent twice. ' : ''}
          Queued for {sent.message.recipient_count} {sent.message.recipient_count === 1 ? 'person' : 'people'}
          {sent.message.excluded_count ? `; ${sent.message.excluded_count} not included` : ''}.
          Delivery outcomes appear as each channel finishes.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Link className="button inline-flex items-center px-3.5 py-2 text-sm font-medium ring-1 ring-slate-300" to={`/messages/${sent.message.id}`}>
            View outcomes
          </Link>
          <Button onClick={onClose}>Done</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open title={plan ? `Message people on ${plan.title}` : 'Message team members'} onClose={onClose} size="wide">
      <div className="space-y-5 text-sm">
        <fieldset>
          <legend className="label">Who</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {(plan ? PLAN_GROUPS : (['team_members'] as MessageAudienceInclude[])).map((group) => (
              <label key={group} className="flex items-center gap-2">
                <input type="checkbox" checked={include.includes(group)} onChange={() => changeAudience(() => setInclude((c) => toggle(c, group)))} />
                {MESSAGE_AUDIENCE_INCLUDE_LABELS[group]}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {plan ? 'Limit to teams (optional; required for team members):' : 'Teams:'}
          </p>
          <div className="mt-1 grid max-h-32 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3">
            {teams.map((team) => (
              <label key={team.id} className="flex items-center gap-2">
                <input type="checkbox" checked={teamIds.includes(team.id)} onChange={() => changeAudience(() => setTeamIds((c) => toggle(c, team.id)))} />
                {team.name}
              </label>
            ))}
          </div>
          <Button className="mt-3" variant="secondary" disabled={audienceInvalid} loading={runPreview.isPending} onClick={() => runPreview.mutate()}>
            {preview ? 'Refresh recipients' : 'Preview recipients'}
          </Button>
          <ErrorNotice error={runPreview.error} />
        </fieldset>

        {staleNotice && (
          <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            The audience changed since your preview. Nothing was sent — review the updated list, then send again.
          </p>
        )}

        {preview && (
          <section>
            <h3 className="mb-1 font-medium text-slate-700">
              {reachable.length} will receive it
              {preview.recipients.length - reachable.length > 0 ? ` · ${preview.recipients.length - reachable.length} not included` : ''}
            </h3>
            {preview.recipients.length === 0 ? (
              <p className="text-slate-500">Nobody matches this selection.</p>
            ) : (
              <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg ring-1 ring-slate-200 dark:divide-slate-800 dark:ring-slate-700">
                {preview.recipients.map((recipient) => (
                  <li key={recipient.person_id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                    <input
                      type="checkbox"
                      aria-label={`Include ${recipient.first_name}`}
                      disabled={!recipient.reachable}
                      checked={recipient.reachable && !excluded.includes(recipient.person_id)}
                      onChange={() => setExcluded((c) => toggle(c, recipient.person_id))}
                    />
                    <span>{[recipient.first_name, recipient.last_name].filter(Boolean).join(' ')}</span>
                    {recipient.reasons.map((reason) => (
                      <Badge key={reason} tone="bg-slate-100 text-slate-600 ring-slate-500/20">{MESSAGE_AUDIENCE_REASON_LABELS[reason]}</Badge>
                    ))}
                    {!recipient.reachable && <span className="text-xs text-rose-600">No email or sign-in — can’t be reached</span>}
                    {recipient.reachable && !recipient.has_email && <span className="text-xs text-slate-500">App only (no email)</span>}
                    {recipient.reachable && !recipient.has_login && <span className="text-xs text-slate-500">Email only</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-slate-700">Message</h3>
            <select className="input !w-auto" value={templateId ?? ''} onChange={(event) => applyTemplate(event.target.value)} aria-label="Template">
              <option value="">No template</option>
              {(templates.data?.templates ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.owner_id ? '' : ' (shared)'}</option>
              ))}
            </select>
          </div>
          <input className="input" placeholder="Subject" maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} />
          <textarea className="input" rows={6} maxLength={8000} placeholder="Write your message…" value={body} onChange={(event) => setBody(event.target.value)} />
          <div className="flex flex-wrap gap-1">
            {MESSAGE_TEMPLATE_VARIABLES.filter((v) => plan || !v.startsWith('plan_')).map((variable) => (
              <button
                key={variable}
                type="button"
                title={MESSAGE_VARIABLE_LABELS[variable]}
                className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600 hover:bg-slate-200"
                onClick={() => setBody((current) => `${current}{{${variable}}}`)}
              >
                {`{{${variable}}}`}
              </button>
            ))}
          </div>
          {unknown.length > 0 && <p role="alert" className="text-xs text-rose-600">Unknown variable: {unknown.join(', ')}</p>}
          {sampleValues && subject && body && (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
              <p className="mb-1 font-medium text-slate-500">Preview for {sample?.first_name}</p>
              <p className="font-medium">{renderMessageTemplate(subject, sampleValues)}</p>
              <p className="whitespace-pre-wrap">{renderMessageTemplate(body, sampleValues)}</p>
            </div>
          )}
          <p className="text-xs text-slate-500">Replies go to your email address. They are not shown in the app.</p>
          <div className="flex gap-2 text-xs">
            <Button variant="ghost" className="!py-1 text-xs" disabled={!subject || !body || unknown.length > 0} loading={saveTemplate.isPending} onClick={() => saveTemplate.mutate(false)}>
              Save as my template
            </Button>
            {templates.data?.can_manage_shared && (
              <Button variant="ghost" className="!py-1 text-xs" disabled={!subject || !body || unknown.length > 0} onClick={() => saveTemplate.mutate(true)}>
                Save as shared template
              </Button>
            )}
          </div>
        </section>

        <ErrorNotice error={send.error && !(send.error instanceof ApiError && send.error.code === 'audience_changed') ? send.error : saveTemplate.error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={send.isPending}
            disabled={!preview || reachable.length === 0 || !subject.trim() || !body.trim() || unknown.length > 0}
            onClick={() => send.mutate()}
          >
            Send to {reachable.length} {reachable.length === 1 ? 'person' : 'people'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
