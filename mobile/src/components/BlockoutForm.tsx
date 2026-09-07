import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Theme } from '../lib/theme';
import { useThemedStyles } from '../lib/useTheme';
import { Button, ErrorNotice, Field } from './ui';

interface BlockoutFormProps {
  onCreated: () => Promise<void>;
}

interface BlockoutRange {
  startsAt: string;
  endsAt: string;
}

const parseDate = (value: string, endOfDay: boolean): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;

  if (endOfDay) date.setHours(23, 59, 59, 999);
  else date.setHours(0, 0, 0, 0);
  return date;
};

const blockoutRange = (from: string, to: string): BlockoutRange => {
  const start = parseDate(from, false);
  const end = parseDate(to, true);
  if (!start || !end) throw new Error('Enter dates as YYYY-MM-DD.');
  if (end < start) throw new Error('The end date must be on or after the start date.');
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
};

export const BlockoutForm = ({ onCreated }: BlockoutFormProps) => {
  const styles = useThemedStyles(makeStyles);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [validationError, setValidationError] = useState<Error | null>(null);

  const createBlockout = useMutation({
    mutationFn: async () => {
      const range = blockoutRange(from, to);
      return api.createBlockout({
        starts_at: range.startsAt,
        ends_at: range.endsAt,
        reason: reason.trim() || null,
      });
    },
    onSuccess: async () => {
      setFrom('');
      setTo('');
      setReason('');
      setValidationError(null);
      await onCreated();
    },
  });

  const submit = (): void => {
    try {
      blockoutRange(from, to);
      setValidationError(null);
      createBlockout.mutate();
    } catch (error) {
      setValidationError(error instanceof Error ? error : new Error('Invalid blockout dates.'));
    }
  };

  return (
    <View style={styles.form}>
      <Text style={styles.description}>
        Dates you can&apos;t serve. Schedulers are warned before they assign you.
      </Text>

      <View style={styles.dateRow}>
        <Field
          label="From"
          accessibilityLabel="Blockout start date"
          value={from}
          onChangeText={setFrom}
          placeholder="YYYY-MM-DD"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={10}
          style={styles.dateInput}
          containerStyle={styles.flex}
        />
        <Field
          label="To"
          accessibilityLabel="Blockout end date"
          value={to}
          onChangeText={setTo}
          placeholder="YYYY-MM-DD"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={10}
          style={styles.dateInput}
          containerStyle={styles.flex}
        />
      </View>

      <Field
        label="Reason"
        accessibilityLabel="Blockout reason"
        value={reason}
        onChangeText={setReason}
        placeholder="Away for a wedding"
        maxLength={200}
      />

      <ErrorNotice error={validationError ?? createBlockout.error} />
      <Button
        title="Add blockout"
        icon="plus"
        variant="secondary"
        onPress={submit}
        loading={createBlockout.isPending}
      />
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    form: { gap: theme.space.lg },
    description: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    dateRow: { flexDirection: 'row', gap: theme.space.md },
    dateInput: { fontFamily: theme.type.numeric.fontFamily, fontSize: 14 },
  });
