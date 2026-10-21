import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';

export interface DiscardGuardOptions {
  /** Leaving would lose something typed. */
  dirty: boolean;
  /** "Discard your changes to this item?" */
  message: string;
  keepLabel: string;
  discardLabel: string;
}

export interface DiscardGuard {
  /** Go back on purpose (after a save) without asking. */
  leave: () => void;
}

/**
 * Asks before Back, a swipe or the header button throws away a draft, as the
 * website editor confirms before closing. Built on `usePreventRemove`, which
 * native-stack honours for its native back button and gesture (a plain
 * `beforeRemove` listener is not). A save calls `leave` instead of going back.
 */
export const useDiscardGuard = ({ dirty, message, keepLabel, discardLabel }: DiscardGuardOptions): DiscardGuard => {
  const navigation = useNavigation();
  const [leaving, setLeaving] = useState(false);

  usePreventRemove(dirty && !leaving, ({ data }) => {
    Alert.alert(message, undefined, [
      { text: keepLabel, style: 'cancel' },
      { text: discardLabel, style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  // Prevention is lifted on the render after `leave`, then the screen goes.
  useEffect(() => {
    if (leaving && navigation.canGoBack()) navigation.goBack();
  }, [leaving, navigation]);

  const leave = useCallback(() => setLeaving(true), []);
  return { leave };
};
