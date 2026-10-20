import { useTranslation } from 'react-i18next';
import { Loading, Screen } from '../../../src/components/ui';

/** Inert external ingress: NavigationIntentProvider validates before leaving it. */
export default function ExternalPlanIngressScreen() {
  const { t } = useTranslation('auth');
  return (
    <Screen>
      <Loading label={t('link.checking')} />
    </Screen>
  );
}
