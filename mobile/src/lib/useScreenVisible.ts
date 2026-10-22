import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';

/**
 * MOB-019: true only while this screen is focused and the app is in the
 * foreground. Polling and read marks follow it, so a thread left open in the
 * background neither keeps polling nor marks new messages as read.
 */
export const useScreenVisible = (): boolean => {
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => setActive(status === 'active'));
    return () => subscription.remove();
  }, []);
  return focused && active;
};
