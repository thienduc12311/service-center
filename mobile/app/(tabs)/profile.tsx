import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/providers/AuthProvider';
import { Avatar, Button, Card, ErrorNotice, SectionTitle } from '../../src/components/ui';
import { theme } from '../../src/lib/theme';

export default function ProfileScreen() {
  const { user, role, organizationId, refreshUser, signOut, switchOrganization } = useAuth();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState(user?.profile.full_name ?? '');
  const [phone, setPhone] = useState(user?.profile.phone ?? '');

  const blockouts = useQuery({
    queryKey: ['blockouts', organizationId],
    queryFn: () => api.listBlockouts({ scope: 'mine' }),
    enabled: Boolean(organizationId),
  });

  const save = useMutation({
    mutationFn: () => api.updateMe({ full_name: fullName, phone: phone || null }),
    onSuccess: async () => {
      await refreshUser();
      Alert.alert('Saved', 'Your profile has been updated.');
    },
  });

  const removeBlockout = useMutation({
    mutationFn: (id: string) => api.deleteBlockout(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['blockouts', organizationId] }),
  });

  const organization = user?.memberships.find((m) => m.organization.id === organizationId)?.organization;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.identity}>
        <Avatar name={user?.profile.full_name ?? user?.profile.email} size={64} />
        <Text style={styles.name}>{user?.profile.full_name ?? 'Your profile'}</Text>
        <Text style={styles.email}>{user?.profile.email}</Text>
        {organization && (
          <Text style={styles.org}>
            {organization.name}
            {role ? ` · ${role}` : ''}
          </Text>
        )}
      </View>

      <Card style={styles.card}>
        <SectionTitle>Details</SectionTitle>
        <TextInput
          style={styles.input}
          value={fullName}
          onChangeText={setFullName}
          placeholder="Full name"
          placeholderTextColor={theme.colors.textFaint}
        />
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder="Phone"
          keyboardType="phone-pad"
          placeholderTextColor={theme.colors.textFaint}
        />
        <ErrorNotice error={save.error} />
        <Button title="Save" onPress={() => save.mutate()} loading={save.isPending} />
      </Card>

      <Card style={styles.card}>
        <SectionTitle>Blockout dates</SectionTitle>
        {blockouts.data?.length ? (
          blockouts.data.map((blockout) => (
            <View key={blockout.id} style={styles.blockout}>
              <View style={styles.flex}>
                <Text style={styles.blockoutRange}>
                  {formatDate(blockout.starts_at)} – {formatDate(blockout.ends_at)}
                </Text>
                {blockout.reason && <Text style={styles.blockoutReason}>{blockout.reason}</Text>}
              </View>
              <Button
                title="Remove"
                variant="secondary"
                onPress={() => removeBlockout.mutate(blockout.id)}
              />
            </View>
          ))
        ) : (
          <Text style={styles.muted}>No blockout dates. Add them from the web app.</Text>
        )}
      </Card>

      {(user?.memberships.length ?? 0) > 1 && (
        <Card style={styles.card}>
          <SectionTitle>Organization</SectionTitle>
          {user?.memberships.map((membership) => (
            <Button
              key={membership.organization.id}
              title={membership.organization.name}
              variant={membership.organization.id === organizationId ? 'primary' : 'secondary'}
              onPress={() => void switchOrganization(membership.organization.id)}
            />
          ))}
        </Card>
      )}

      <Button title="Sign out" variant="danger" onPress={() => void signOut()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16, paddingBottom: 40 },
  identity: { alignItems: 'center', gap: 4, paddingVertical: 16 },
  name: { fontSize: 18, fontWeight: '700', color: theme.colors.text, marginTop: 8 },
  email: { fontSize: 14, color: theme.colors.textMuted },
  org: { fontSize: 13, color: theme.colors.brand, textTransform: 'capitalize' },
  card: { gap: 10 },
  flex: { flex: 1 },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.colors.text,
  },
  blockout: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  blockoutRange: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  blockoutReason: { fontSize: 13, color: theme.colors.textMuted },
  muted: { color: theme.colors.textMuted, fontSize: 14 },
});
