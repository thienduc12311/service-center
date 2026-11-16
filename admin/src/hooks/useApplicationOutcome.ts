import { useState } from 'react';
import type { ApplicationOutcome } from '../components/ApplicationCard';
import { useRefreshAdminData } from './queries';

export interface ApplicationOutcomeState {
  outcome: ApplicationOutcome | null;
  report: (outcome: ApplicationOutcome) => void;
  dismiss: () => void;
}

/** Remembers the last outcome; a stale application refetches everything so the page shows where it stands. */
export const useApplicationOutcome = (): ApplicationOutcomeState => {
  const refresh = useRefreshAdminData();
  const [outcome, setOutcome] = useState<ApplicationOutcome | null>(null);
  return {
    outcome,
    report: (next) => {
      setOutcome(next);
      if (next.kind === 'stale') void refresh();
    },
    dismiss: () => setOutcome(null),
  };
};
