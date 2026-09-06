import { useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, isAdmin, STORAGE_BUCKETS } from '@service-center/shared';
import * as ImagePicker from 'expo-image-picker';
import { useColorScheme } from 'nativewind';
import { api } from '../../src/lib/api';
import { supabase } from '../../src/lib/supabase';
import { base64ToBytes } from '../../src/lib/base64';
import { useAuth } from '../../src/providers/AuthProvider';
import { Avatar, Button, Card, ErrorNotice, SectionTitle } from '../../src/components/ui';
import { BlockoutForm } from '../../src/components/BlockoutForm';
import { theme } from '../../src/lib/theme';

export default function ProfileScreen() {
  const { user, role, organizationId, refreshUser, signOut, switchOrganization } = useAuth();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState(user?.profile.full_name ?? '');
  const [phone, setPhone] = useState(user?.profile.phone ?? '');
  const [newOrganizationName, setNewOrganizationName] = useState('');
  const [organizationError, setOrganizationError] = useState<unknown>(null);
  const [creatingOrganization, setCreatingOrganization] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const { colorScheme, setColorScheme } = useColorScheme();

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

  const refreshBlockouts = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['blockouts', organizationId] });
  };

  const organization = user?.memberships.find((m) => m.organization.id === organizationId)?.organization;

  const createOrganization = async () => {
    const baseSlug = newOrganizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const slug = `${baseSlug.slice(0, 35)}-${Date.now().toString(36).slice(-4)}`;
    setCreatingOrganization(true);
    setOrganizationError(null);
    try {
      const created = await api.createOrganization({
        name: newOrganizationName,
        slug,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setNewOrganizationName('');
      await refreshUser();
      await switchOrganization(created.id);
    } catch (error) {
      setOrganizationError(error);
    } finally {
      setCreatingOrganization(false);
    }
  };

  const updateLogo = async () => {
    if (!organizationId) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert('Permission needed', 'Allow photo access to choose a logo.');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.85 });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) return;
    setUploadingLogo(true);
    setOrganizationError(null);
    try {
      const path = `${organizationId}/logo-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from(STORAGE_BUCKETS.organizationLogos).upload(path, base64ToBytes(asset.base64), { contentType: 'image/jpeg' });
      if (error) throw error;
      const { data } = supabase.storage.from(STORAGE_BUCKETS.organizationLogos).getPublicUrl(path);
      await api.updateOrganization(organizationId, { logo_url: data.publicUrl });
      await refreshUser();
    } catch (error) {
      setOrganizationError(error);
    } finally {
      setUploadingLogo(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.identity}>
        {organization?.logo_url ? <Image source={{ uri: organization.logo_url }} className="size-16 rounded-2xl" /> : <Avatar name={user?.profile.full_name ?? user?.profile.email} size={64} />}
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

      <Card className="gap-3">
        <SectionTitle>Appearance</SectionTitle>
        <Text className="text-sm text-slate-500 dark:text-slate-400">Use a comfortable theme in every environment.</Text>
        <View className="flex-row gap-2">
          <View className="flex-1"><Button title="Light" variant={colorScheme === 'light' ? 'primary' : 'secondary'} onPress={() => setColorScheme('light')} /></View>
          <View className="flex-1"><Button title="Dark" variant={colorScheme === 'dark' ? 'primary' : 'secondary'} onPress={() => setColorScheme('dark')} /></View>
        </View>
      </Card>

      <Card className="gap-3">
        <SectionTitle>Organizations</SectionTitle>
        <Text className="text-sm text-slate-500 dark:text-slate-400">Create another church or ministry whenever you need one.</Text>
        {isAdmin(role) && <Button title={uploadingLogo ? 'Uploading…' : 'Update organization logo'} variant="secondary" onPress={() => void updateLogo()} disabled={uploadingLogo} />}
        <TextInput
          className="rounded-xl border border-slate-200 px-3 py-3 text-slate-900 dark:border-slate-700 dark:text-white"
          value={newOrganizationName}
          onChangeText={setNewOrganizationName}
          placeholder="New organization name"
          placeholderTextColor={theme.colors.textFaint}
        />
        <Button title="Create organization" onPress={() => void createOrganization()} loading={creatingOrganization} disabled={newOrganizationName.trim().length < 2} />
        <ErrorNotice error={organizationError} />
      </Card>

      <Card style={styles.card}>
        <SectionTitle>Blockout dates</SectionTitle>
        <BlockoutForm onCreated={refreshBlockouts} />
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
          <Text style={styles.muted}>No blockout dates.</Text>
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
