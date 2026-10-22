import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  PLAN_MESSAGE_GROUPS,
  defaultMessageInclude,
  keptExclusions,
  messageAudience,
  messageAudienceProblem,
  messageRecipientsToSend,
  messageSendBody,
  messageSendOutcome,
  messageVariableValues,
  messageVariablesFor,
  renderMessageTemplate,
  unknownMessageVariables,
  type MessageAudienceInclude,
  type MessageAudiencePreview,
  type MessageSendOutcome,
  type SendOperationalMessageResult,
  type TeamWithPositions,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg, useMessageTemplates } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { useFormatters } from '../../i18n';
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

/**
 * Choose → preview → write → explicit Send. Preview sends nothing. The send
 * carries the previewed audience version; if the audience changed in the
 * meantime the server refuses and the preview is refreshed for review. One
 * idempotency key per composed message (kept across edits), so a retried
 * Send is one message, and a changed resend after an unanswered one is
 * refused rather than sent twice. Rules shared with native (MOB-018).
 */
export const MessageComposerModal = ({ plan, teams, onClose }: MessageComposerModalProps) => {
  const { t } = useTranslation(['messages', 'common']);
  const format = useFormatters();
  const invalidate = useInvalidateOrg();
  const { user, organizationId } = useAuth();
  const templates = useMessageTemplates();
  const sendKey = useRef<string>(`message-${crypto.randomUUID()}`);

  const [include, setInclude] = useState<MessageAudienceInclude[]>(defaultMessageInclude(Boolean(plan)));
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<MessageAudiencePreview | null>(null);
  const [staleNotice, setStaleNotice] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sent, setSent] = useState<SendOperationalMessageResult | null>(null);
  const [outcome, setOutcome] = useState<MessageSendOutcome | null>(null);
  // The content of a send that got no answer: editing it afterwards is warned about.
  const [uncertainContent, setUncertainContent] = useState<string | null>(null);

  const audience = useMemo(() => messageAudience(plan?.id ?? null, include, teamIds), [plan, teamIds, include]);
  const audienceInvalid = messageAudienceProblem(audience) !== null;
  const content = JSON.stringify([subject, body, templateId, [...excluded].sort()]);

  const runPreview = useMutation({
    mutationFn: () => api.previewMessage({ audience }),
    onSuccess: (result) => {
      setPreview(result);
      setExcluded((current) => keptExclusions(result, current));
    },
  });

  const send = useMutation({
    mutationFn: () => api.sendMessage(messageSendBody({
      audience,
      subject,
      body,
      templateId,
      excluded,
      preview: preview!,
      idempotencyKey: sendKey.current,
    })),
    onSuccess: async (result) => {
      setSent(result);
      setOutcome(null);
      await invalidate();
    },
    onError: (error) => {
      const next = messageSendOutcome(error);
      setOutcome(next);
      if (next === 'uncertain') setUncertainContent(content);
      if (next === 'audienceChanged') {
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

  const reachable = messageRecipientsToSend(preview, excluded);
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
    const template = templates.data?.templates.find((candidate) => candidate.id === id);
    setTemplateId(template?.id ?? null);
    if (template) {
      setSubject(template.subject);
      setBody(template.body);
    }
  };

  const saveTemplate = useMutation({
    mutationFn: (shared: boolean) => {
      const name = window.prompt(t('messageComposer.templateNamePrompt'));
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
      <Modal open title={t('messageComposer.sentTitle')} onClose={onClose}>
        <div className="space-y-1 text-sm text-slate-600">
          {sent.replayed && <p>{t('messageComposer.replayed')}</p>}
          <p>
            {sent.message.excluded_count
              ? t('messageComposer.queuedWithExcluded', { count: sent.message.recipient_count, excluded: sent.message.excluded_count })
              : t('messageComposer.queued', { count: sent.message.recipient_count })}
          </p>
          <p>{t('messageComposer.outcomesNote')}</p>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Link className="button inline-flex items-center px-3.5 py-2 text-sm font-medium ring-1 ring-slate-300" to={`/messages/${sent.message.id}`}>
            {t('messageComposer.viewOutcomes')}
          </Link>
          <Button onClick={onClose}>{t('common:actions.done')}</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open title={plan ? t('messageComposer.planTitle', { plan: plan.title }) : t('messageComposer.teamTitle')} onClose={onClose} size="wide">
      <div className="space-y-5 text-sm">
        <fieldset>
          <legend className="label">{t('messageComposer.who')}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {(plan ? PLAN_MESSAGE_GROUPS : (['team_members'] as const)).map((group) => (
              <label key={group} className="flex items-center gap-2">
                <input type="checkbox" checked={include.includes(group)} onChange={() => changeAudience(() => setInclude((c) => toggle(c, group)))} />
                {t(`audienceInclude.${group}`)}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {plan ? t('messageComposer.limitTeamsHint') : t('messageComposer.teamsLabel')}
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
            {preview ? t('messageComposer.refreshRecipients') : t('messageComposer.previewRecipients')}
          </Button>
          <ErrorNotice error={runPreview.error} />
        </fieldset>

        {staleNotice && (
          <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            {t('messageComposer.staleNotice')}
          </p>
        )}

        {preview && (
          <section>
            <h3 className="mb-1 font-medium text-slate-700">
              {preview.recipients.length - reachable.length > 0
                ? t('messageComposer.willReceiveWithExcluded', { count: reachable.length, excluded: preview.recipients.length - reachable.length })
                : t('messageComposer.willReceive', { count: reachable.length })}
            </h3>
            {preview.recipients.length === 0 ? (
              <p className="text-slate-500">{t('messageComposer.nobodyMatches')}</p>
            ) : (
              <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg ring-1 ring-slate-200 dark:divide-slate-800 dark:ring-slate-700">
                {preview.recipients.map((recipient) => (
                  <li key={recipient.person_id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                    <input
                      type="checkbox"
                      aria-label={t('messageComposer.includeName', { name: recipient.first_name })}
                      disabled={!recipient.reachable}
                      checked={recipient.reachable && !excluded.includes(recipient.person_id)}
                      onChange={() => setExcluded((c) => toggle(c, recipient.person_id))}
                    />
                    <span>{[recipient.first_name, recipient.last_name].filter(Boolean).join(' ')}</span>
                    {recipient.reasons.map((reason) => (
                      <Badge key={reason} tone="bg-slate-100 text-slate-600 ring-slate-500/20">{t(`audienceReasons.${reason}`)}</Badge>
                    ))}
                    {!recipient.reachable && <span className="text-xs text-rose-600">{t('messageComposer.unreachable')}</span>}
                    {recipient.reachable && !recipient.has_email && <span className="text-xs text-slate-500">{t('messageComposer.appOnly')}</span>}
                    {recipient.reachable && !recipient.has_login && <span className="text-xs text-slate-500">{t('messageComposer.emailOnly')}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-slate-700">{t('messageComposer.messageHeading')}</h3>
            <select className="input !w-auto" value={templateId ?? ''} onChange={(event) => applyTemplate(event.target.value)} aria-label={t('messageComposer.templateLabel')}>
              <option value="">{t('messageComposer.noTemplate')}</option>
              {(templates.data?.templates ?? []).map((template) => (
                <option key={template.id} value={template.id}>
                  {template.owner_id ? template.name : t('messageComposer.sharedTemplate', { name: template.name })}
                </option>
              ))}
            </select>
          </div>
          <input className="input" placeholder={t('messageComposer.subjectPlaceholder')} maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} />
          <textarea className="input" rows={6} maxLength={8000} placeholder={t('messageComposer.bodyPlaceholder')} value={body} onChange={(event) => setBody(event.target.value)} />
          <div className="flex flex-wrap gap-1">
            {messageVariablesFor(Boolean(plan)).map((variable) => (
              <button
                key={variable}
                type="button"
                title={t(`messageComposer.variables.${variable}`)}
                className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600 hover:bg-slate-200"
                onClick={() => setBody((current) => `${current}{{${variable}}}`)}
              >
                {`{{${variable}}}`}
              </button>
            ))}
          </div>
          {unknown.length > 0 && <p role="alert" className="text-xs text-rose-600">{t('messageComposer.unknownVariables', { count: unknown.length, names: format.list(unknown) })}</p>}
          {sampleValues && subject && body && (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
              <p className="mb-1 font-medium text-slate-500">{t('messageComposer.previewFor', { name: sample?.first_name ?? '' })}</p>
              <p className="font-medium">{renderMessageTemplate(subject, sampleValues)}</p>
              <p className="whitespace-pre-wrap">{renderMessageTemplate(body, sampleValues)}</p>
            </div>
          )}
          <p className="text-xs text-slate-500">{t('messageComposer.repliesNote')}</p>
          <div className="flex gap-2 text-xs">
            <Button variant="ghost" className="!py-1 text-xs" disabled={!subject || !body || unknown.length > 0} loading={saveTemplate.isPending} onClick={() => saveTemplate.mutate(false)}>
              {t('messageComposer.saveMine')}
            </Button>
            {templates.data?.can_manage_shared && (
              <Button variant="ghost" className="!py-1 text-xs" disabled={!subject || !body || unknown.length > 0} onClick={() => saveTemplate.mutate(true)}>
                {t('messageComposer.saveShared')}
              </Button>
            )}
          </div>
        </section>

        {outcome === 'uncertain' && (
          <div role="alert" className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            <p>{t('messageComposer.uncertain')}</p>
            {uncertainContent !== null && uncertainContent !== content && <p>{t('messageComposer.editedAfterUncertain')}</p>}
          </div>
        )}
        {outcome === 'keyReused' && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            <p>{t('messageComposer.keyReused')}</p>
            <Link className="underline" to="/messages">{t('messageComposer.viewSent')}</Link>
          </div>
        )}
        <ErrorNotice error={outcome === 'refused' ? send.error : saveTemplate.error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button
            loading={send.isPending}
            disabled={!preview || reachable.length === 0 || !subject.trim() || !body.trim() || unknown.length > 0 || outcome === 'keyReused'}
            onClick={() => send.mutate()}
          >
            {outcome === 'uncertain' ? t('messageComposer.tryAgain') : t('messageComposer.sendTo', { count: reachable.length })}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
