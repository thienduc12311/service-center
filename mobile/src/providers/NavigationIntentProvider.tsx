import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import {
  parseExternalNavigationUrl,
  parsePushNavigationIntent,
  type ExternalNavigationParseResult,
  type NavigationIntent,
} from '@service-center/shared';
import { api } from '../lib/api';
import { env } from '../lib/env';
import {
  PrivateIntentCoordinator,
  resolvePrivateNavigationIntent,
} from '../lib/navigation-intents';
import { useAuth } from './AuthProvider';

const navigationPolicy = {
  schemes: ['servicecenter'],
  hosts: env.webAppDomain ? [env.webAppDomain] : [],
};

/** Owns the one allowlisted entry point for external URLs and push taps. */
export const NavigationIntentProvider = ({ children }: { children: ReactNode }) => {
  const auth = useAuth();
  const router = useRouter();
  const authRef = useRef(auth);
  authRef.current = auth;
  const coordinatorRef = useRef<PrivateIntentCoordinator | null>(null);
  if (!coordinatorRef.current) coordinatorRef.current = new PrivateIntentCoordinator();
  const coordinator = coordinatorRef.current;
  const processingRef = useRef(false);
  const [revision, setRevision] = useState(0);

  const showFailure = useCallback(
    (reason: 'invalid' | 'no-access' | 'unavailable' | 'network') => {
      router.replace({ pathname: '/link-result', params: { reason } });
    },
    [router],
  );

  const routeIntent = useCallback(
    (intent: NavigationIntent) => {
      if (intent.kind === 'accept-invite') {
        router.replace({ pathname: '/accept-invite', params: { token: intent.token } });
        return;
      }
      if (intent.kind === 'assignment-response') {
        router.replace({ pathname: '/respond', params: { token: intent.token } });
        return;
      }

      if (!coordinator.offer(intent)) return;
      setRevision((value) => value + 1);
      if (!authRef.current.session) router.replace('/(auth)/login');
    },
    [coordinator, router],
  );

  const handleParseResult = useCallback(
    (result: ExternalNavigationParseResult) => {
      if (result.status === 'ignored') return;
      if (result.status === 'rejected') {
        showFailure('invalid');
        return;
      }
      routeIntent(result.intent);
    },
    [routeIntent, showFailure],
  );

  useEffect(() => {
    let active = true;
    void Linking.getInitialURL().then((url) => {
      if (active && url) {
        handleParseResult(parseExternalNavigationUrl(url, navigationPolicy));
      }
    });
    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleParseResult(parseExternalNavigationUrl(url, navigationPolicy));
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [handleParseResult]);

  useEffect(() => {
    const handleResponse = (response: Notifications.NotificationResponse): void => {
      handleParseResult(
        parsePushNavigationIntent(response.notification.request.content.data),
      );
    };

    let active = true;
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!active || !response) return;
      handleResponse(response);
      void Notifications.clearLastNotificationResponseAsync();
    });
    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
    return () => {
      active = false;
      subscription.remove();
    };
  }, [handleParseResult]);

  useEffect(() => {
    if (processingRef.current) return;
    const ready = Boolean(auth.session && auth.ready && auth.user && auth.queryScope);
    const intent = coordinator.takeIfReady(ready);
    if (!intent || !auth.user) return;

    processingRef.current = true;
    let consume = true;
    const user = auth.user;
    const activeOrganizationId = auth.organizationId;
    void resolvePrivateNavigationIntent(intent, user, activeOrganizationId, {
      switchOrganization: auth.switchOrganization,
      currentScope: auth.currentQueryScope,
      loadNotification: (notificationId) => api.getNotification(notificationId),
      loadPlan: (planId) => api.getPlan(planId),
    })
      .then((resolution) => {
        if (resolution.status === 'failed') {
          if (resolution.reason === 'network') consume = false;
          showFailure(resolution.reason);
          return;
        }
        if (resolution.destination.kind === 'plan') {
          router.replace(`/plan/${resolution.destination.planId}`);
        } else {
          router.replace('/notifications');
        }
      })
      .catch(() => {
        consume = false;
        showFailure('network');
      })
      .finally(() => {
        coordinator.complete(intent, consume);
        processingRef.current = false;
        if (coordinator.hasPending()) setRevision((value) => value + 1);
      });
  }, [auth, coordinator, revision, router, showFailure]);

  return children;
};
