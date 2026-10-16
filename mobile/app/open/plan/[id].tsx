import { Loading, Screen } from '../../../src/components/ui';

/** Inert external ingress: NavigationIntentProvider validates before leaving it. */
export default function ExternalPlanIngressScreen() {
  return (
    <Screen>
      <Loading label="Checking this link" />
    </Screen>
  );
}
