import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Loading, Screen } from '../src/components/ui';

export default function NotFoundScreen() {
  const { t } = useTranslation('auth');
  const router = useRouter();
  useEffect(() => {
    router.replace({ pathname: '/link-result', params: { reason: 'invalid' } });
  }, [router]);
  return (
    <Screen>
      <Loading label={t('link.checking')} />
    </Screen>
  );
}
