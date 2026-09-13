import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  COMMON_TEAM_TEMPLATES,
  toISODate,
  type ServiceTypeSetupPayload,
} from '@service-center/shared';
import { api } from '../lib/api';
import { useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, ErrorNotice } from '../components/ui';
import { WizardProgress } from '../components/service-type/WizardProgress';
import { NameStep } from '../components/service-type/NameStep';
import { TimesStep, emptyServiceTime } from '../components/service-type/TimesStep';
import { TeamsStep } from '../components/service-type/TeamsStep';
import type { NameStepValue, ServiceTimeDraft, WizardStep } from '../components/service-type/types';

/** The next Sunday, which is what most organizations are planning towards. */
const nextSunday = (): string => {
  const date = new Date();
  date.setDate(date.getDate() + ((7 - date.getDay()) % 7 || 7));
  return toISODate(date);
};

/** `2026-09-13` + `10:00` in the browser's own zone, as the instant the API stores. */
const toInstant = (date: string, time: string): string => new Date(`${date}T${time}`).toISOString();

export const ServiceTypeWizardPage = () => {
  const navigate = useNavigate();
  const invalidate = useInvalidateOrg();
  const { canManage } = useAuth();

  const [step, setStep] = useState<WizardStep>('name');
  const [name, setName] = useState<NameStepValue>({ name: '', recurrence: 'weekly' });
  const [times, setTimes] = useState<ServiceTimeDraft[]>(() => [
    { ...emptyServiceTime(), date: nextSunday() },
  ]);
  const [teamNames, setTeamNames] = useState<string[]>([]);
  const [joinTeams, setJoinTeams] = useState(true);

  const trimmedName = name.name.trim();
  const displayName = trimmedName || 'this service';

  /** Every row needs a date, and each service has to end after it starts. */
  const timesAreValid = useMemo(
    () => times.length > 0 && times.every((time) => time.date && time.from && time.to && time.to > time.from),
    [times],
  );

  const setUp = useMutation({
    mutationFn: () => {
      const payload: ServiceTypeSetupPayload = {
        name: trimmedName,
        recurrence: name.recurrence,
        join_teams: joinTeams,
        times: times.map((time) => ({
          kind: 'service',
          name: null,
          starts_at: toInstant(time.date, time.from),
          ends_at: toInstant(time.date, time.to),
        })),
        teams: COMMON_TEAM_TEMPLATES.filter((template) => teamNames.includes(template.name)).map(
          (template) => ({
            name: template.name,
            color: template.color,
            positions: [...template.positions],
          }),
        ),
      };
      return api.setUpServiceType(payload);
    },
    onSuccess: async (result) => {
      await invalidate();
      navigate(`/plans/${result.plan.id}`, { replace: true });
    },
  });

  if (!canManage) {
    return (
      <div className="card mx-auto max-w-lg p-6 text-center text-sm text-slate-500">
        Only owners, admins and schedulers can add a Service Type.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-12">
      <WizardProgress current={step} />

      <div className="card overflow-hidden">
        <div className="p-8 sm:p-10">
          {step === 'name' && <NameStep value={name} onChange={setName} />}
          {step === 'times' && (
            <TimesStep serviceTypeName={displayName} times={times} onChange={setTimes} />
          )}
          {step === 'teams' && (
            <TeamsStep
              serviceTypeName={displayName}
              selected={teamNames}
              onChange={setTeamNames}
              joinTeams={joinTeams}
              onJoinTeamsChange={setJoinTeams}
            />
          )}

          {setUp.error && (
            <div className="mt-6">
              <ErrorNotice error={setUp.error} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-8 py-4">
          {step === 'name' ? (
            <Button type="button" variant="ghost" onClick={() => navigate('/plans')}>
              Cancel
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep(step === 'teams' ? 'times' : 'name')}
            >
              ‹ Back
            </Button>
          )}

          {step === 'name' && (
            <Button type="button" disabled={!trimmedName} onClick={() => setStep('times')}>
              Next: Add Times
            </Button>
          )}
          {step === 'times' && (
            <Button type="button" disabled={!timesAreValid} onClick={() => setStep('teams')}>
              Next: Add Teams
            </Button>
          )}
          {step === 'teams' && (
            <Button type="button" loading={setUp.isPending} onClick={() => setUp.mutate()}>
              Finish
            </Button>
          )}
        </div>
      </div>

      {step === 'times' && !timesAreValid && (
        <p className="mt-3 text-center text-sm text-amber-600">
          Every service time needs a date, and must end after it starts.
        </p>
      )}
    </div>
  );
};
