import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { theme } from '../lib/theme';
import { Button, ErrorNotice } from './ui';

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

  const submit = () => {
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
        Dates you can’t serve. Schedulers are warned before assigning you.
      </Text>
      <View style={styles.dateRow}>
        <View style={styles.dateField}>
          <Text style={styles.label}>From</Text>
          <TextInput
            accessibilityLabel="Blockout start date"
            style={styles.input}
            value={from}
            onChangeText={setFrom}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={10}
            placeholderTextColor={theme.colors.textFaint}
          />
        </View>
        <View style={styles.dateField}>
          <Text style={styles.label}>To</Text>
          <TextInput
            accessibilityLabel="Blockout end date"
            style={styles.input}
            value={to}
            onChangeText={setTo}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={10}
            placeholderTextColor={theme.colors.textFaint}
          />
        </View>
      </View>
      <Text style={styles.label}>Reason (optional)</Text>
      <TextInput
        accessibilityLabel="Blockout reason"
        style={styles.input}
        value={reason}
        onChangeText={setReason}
        placeholder="Vacation"
        maxLength={200}
        placeholderTextColor={theme.colors.textFaint}
      />
      <ErrorNotice error={validationError ?? createBlockout.error} />
      <Button title="Add blockout" onPress={submit} loading={createBlockout.isPending} />
    </View>
  );
};

const styles = StyleSheet.create({
  form: { gap: 10 },
  description: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 20 },
  dateRow: { flexDirection: 'row', gap: 10 },
  dateField: { flex: 1, gap: 6 },
  label: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.colors.text,
  },
});
