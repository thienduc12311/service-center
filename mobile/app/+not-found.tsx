import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Loading, Screen } from '../src/components/ui';

export default function NotFoundScreen() {
  const router = useRouter();
  useEffect(() => {
    router.replace({ pathname: '/link-result', params: { reason: 'invalid' } });
  }, [router]);
  return (
    <Screen>
      <Loading label="Checking this link" />
    </Screen>
  );
}
