import { useMemo, useState } from 'react';
import { Alert, Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { formatDate, isAdmin, STORAGE_BUCKETS, type BlockoutRow } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { supabase } from '../../src/lib/supabase';
import { base64ToBytes } from '../../src/lib/base64';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Avatar,
  Button,
  Card,
  Divider,
  Field,
  IconButton,
  Label,
  Loading,
  Screen,
  SegmentedControl,
  screenPadding,
  ErrorNotice,
  type SegmentOption,
} from '../../src/components/ui';
import { NotificationBell } from '../../src/components/NotificationBell';
import { BlockoutForm } from '../../src/components/BlockoutForm';
import { Reveal } from '../../src/components/motion';
import type { ColorSchemeName, Theme } from '../../src/lib/theme';
import { useColorSchemeControl, useTheme, useThemedStyles } from '../../src/lib/useTheme';
import { env } from '../../src/lib/env';

const SCHEMES: readonly SegmentOption<ColorSchemeName>[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function ProfileScreen() {
  const {
    user,
    role,
    organizationId,
    queryScope,
    generation,
    isCurrentGeneration,
    refreshUser,
    signOut,
    switchOrganization,
  } = useAuth();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const queryClient = useQueryClient();
  const { scheme, setScheme } = useColorSchemeControl();

  const [fullName, setFullName] = useState(user?.profile.full_name ?? '');
  const [phone, setPhone] = useState(user?.profile.phone ?? '');
  const [newOrganizationName, setNewOrganizationName] = useState('');
  const [organizationError, setOrganizationError] = useState<unknown>(null);
  const [creatingOrganization, setCreatingOrganization] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<unknown>(null);
  const [editingBlockout, setEditingBlockout] = useState<BlockoutRow | null>(null);

  const blockouts = useQuery({
    queryKey: queryKeys.blockouts(queryScope),
    queryFn: () => api.listBlockouts({ scope: 'mine' }),
    enabled: Boolean(queryScope),
  });

  const save = useMutation({
    mutationFn: () => api.updateMe({ full_name: fullName, phone: phone || null }),
    onSuccess: async () => {
      if (!isCurrentGeneration(generation)) return;
      await refreshUser();
      if (!isCurrentGeneration(generation)) return;
      Alert.alert('Saved', 'Your profile has been updated.');
    },
  });

  const removeBlockout = useMutation({
    mutationFn: (blockout: BlockoutRow) => api.deleteBlockout(blockout.id, blockout.revision),
    onSuccess: () => {
      if (!isCurrentGeneration(generation)) return;
      return queryClient.invalidateQueries({ queryKey: queryKeys.blockouts(queryScope) });
    },
  });

  const refreshBlockouts = async (): Promise<void> => {
    if (!isCurrentGeneration(generation)) return;
    await queryClient.invalidateQueries({ queryKey: queryKeys.blockouts(queryScope) });
  };

  const organization = user?.memberships.find(
    (membership) => membership.organization.id === organizationId,
  )?.organization;

  const createOrganization = async (): Promise<void> => {
    const baseSlug = newOrganizationName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const slug = `${baseSlug.slice(0, 35)}-${Date.now().toString(36).slice(-4)}`;

    setCreatingOrganization(true);
    setOrganizationError(null);
    try {
      const created = await api.createOrganization({
        name: newOrganizationName,
        slug,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (!isCurrentGeneration(generation)) return;
      setNewOrganizationName('');
      await refreshUser();
      if (!isCurrentGeneration(generation)) return;
      await switchOrganization(created.id);
    } catch (error) {
      if (isCurrentGeneration(generation)) setOrganizationError(error);
    } finally {
      if (isCurrentGeneration(generation)) setCreatingOrganization(false);
    }
  };

  const updateLogo = async (): Promise<void> => {
    if (!organizationId) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!isCurrentGeneration(generation)) return;
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo access to choose a logo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.85,
    });
    if (!isCurrentGeneration(generation)) return;
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) return;

    setUploadingLogo(true);
    setOrganizationError(null);
    try {
      const path = `${organizationId}/logo-${Date.now()}.jpg`;
      const { error } = await supabase.storage
        .from(STORAGE_BUCKETS.organizationLogos)
        .upload(path, base64ToBytes(asset.base64), { contentType: 'image/jpeg' });
      if (error) throw error;
      if (!isCurrentGeneration(generation)) return;
      const { data } = supabase.storage.from(STORAGE_BUCKETS.organizationLogos).getPublicUrl(path);
      await api.updateOrganization(organizationId, { logo_url: data.publicUrl });
      if (!isCurrentGeneration(generation)) return;
      await refreshUser();
    } catch (error) {
      if (isCurrentGeneration(generation)) setOrganizationError(error);
    } finally {
      if (isCurrentGeneration(generation)) setUploadingLogo(false);
    }
  };

  const memberships = user?.memberships ?? [];
  const visibleBlockouts = useMemo(() => {
    const seenSeries = new Set<string>();
    return (blockouts.data ?? []).filter((row) => {
      if (!row.series_id) return true;
      if (seenSeries.has(row.series_id)) return false;
      seenSeries.add(row.series_id);
      return true;
    });
  }, [blockouts.data]);

  const submitSignOut = async (): Promise<void> => {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
    } catch (error) {
      if (!isCurrentGeneration(generation)) return;
      setSignOutError(error);
      setSigningOut(false);
    }
  };

  return (
    <Screen safeTop>
      <NotificationBell />
      <ScrollView
        contentContainerStyle={screenPadding(theme)}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Reveal>
          <View style={styles.identity}>
            {organization?.logo_url ? (
              <Image source={{ uri: organization.logo_url }} style={styles.logo} />
            ) : (
              <Avatar name={user?.profile.full_name ?? user?.profile.email} size={64} />
            )}
            <Text style={styles.name}>{user?.profile.full_name ?? 'Your profile'}</Text>
            <Text style={styles.email}>{user?.profile.email}</Text>
            {organization ? (
              <Text style={styles.membership}>
                {`${organization.name}${role ? ` · ${role}` : ''}`}
              </Text>
            ) : null}
          </View>
        </Reveal>

        <Reveal index={1}>
          <Card>
            <Label>Your details</Label>
            <Field label="Full name" value={fullName} onChangeText={setFullName} placeholder="Full name" />
            <Field
              label="Phone"
              value={phone}
              onChangeText={setPhone}
              placeholder="Optional"
              keyboardType="phone-pad"
            />
            <ErrorNotice error={save.error} />
            <Button title="Save changes" onPress={() => save.mutate()} loading={save.isPending} />
          </Card>
        </Reveal>

        <Reveal index={2}>
          <Card>
            <Label>Appearance</Label>
            <Text style={styles.body}>
              A light page for planning at a desk, a dark one for a dim stage.
            </Text>
            <SegmentedControl options={SCHEMES} value={scheme} onChange={setScheme} />
          </Card>
        </Reveal>

        <Reveal index={3}>
          <Card>
            <Label>Blockout dates</Label>
            <BlockoutForm
              editing={editingBlockout}
              onSaved={async () => { setEditingBlockout(null); await refreshBlockouts(); }}
              onCancelEdit={() => setEditingBlockout(null)}
            />

            {blockouts.isLoading ? <Loading /> : null}
            {visibleBlockouts.length ? (
              <View>
                {visibleBlockouts.map((blockout, index) => (
                  <View key={blockout.id}>
                    {index > 0 ? <Divider /> : null}
                    <View style={styles.blockout}>
                      <View style={styles.flex}>
                        <Text style={styles.blockoutRange}>
                          {blockout.local_start_date ?? formatDate(blockout.starts_at)}
                          {blockout.all_day ? ' · all day' : blockout.local_start_time ? ` · ${blockout.local_start_time.slice(0, 5)}–${blockout.local_end_time?.slice(0, 5)}` : ` – ${formatDate(blockout.ends_at)}`}
                        </Text>
                        {blockout.reason ? (
                          <Text style={styles.blockoutReason}>{blockout.reason}</Text>
                        ) : null}
                      </View>
                      {blockout.series_id ? (
                        <Button
                          title="Manage on website"
                          variant="quiet"
                          onPress={() => void Linking.openURL(`${env.webAppDomain ? `https://${env.webAppDomain}` : 'http://localhost:5173'}/settings/blockouts/${blockout.series_id}`)}
                        />
                      ) : (
                        <View style={styles.blockoutActions}>
                          <Button title="Edit" variant="quiet" onPress={() => setEditingBlockout(blockout)} />
                          <IconButton
                            name="trash"
                            accessibilityLabel={`Remove blockout from ${blockout.local_start_date ?? formatDate(blockout.starts_at)}`}
                            onPress={() => removeBlockout.mutate(blockout)}
                          />
                        </View>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.body}>You have no blockout dates.</Text>
            )}
          </Card>
        </Reveal>

        {memberships.length > 1 ? (
          <Reveal index={4}>
            <Card>
              <Label>Switch organization</Label>
              {memberships.map((membership) => (
                <Button
                  key={membership.organization.id}
                  title={membership.organization.name}
                  variant={
                    membership.organization.id === organizationId ? 'primary' : 'secondary'
                  }
                  onPress={() => void switchOrganization(membership.organization.id)}
                />
              ))}
            </Card>
          </Reveal>
        ) : null}

        <Reveal index={5}>
          <Card>
            <Label>Organizations</Label>
            <Text style={styles.body}>
              Start another church or ministry whenever you need one — you stay signed in to both.
            </Text>
            {isAdmin(role) ? (
              <Button
                title={uploadingLogo ? 'Uploading' : 'Change the logo'}
                icon="image"
                variant="secondary"
                onPress={() => void updateLogo()}
                disabled={uploadingLogo}
              />
            ) : null}
            <Field
              label="New organization"
              value={newOrganizationName}
              onChangeText={setNewOrganizationName}
              placeholder="Grace Community Church"
            />
            <ErrorNotice error={organizationError} />
            <Button
              title="Create organization"
              onPress={() => void createOrganization()}
              loading={creatingOrganization}
              disabled={newOrganizationName.trim().length < 2}
            />
          </Card>
        </Reveal>

        <Reveal index={6}>
          <View style={styles.signOut}>
            <ErrorNotice error={signOutError} />
            <Button
              title="Sign out"
              icon="signOut"
              variant="danger"
              loading={signingOut}
              onPress={() => void submitSignOut()}
            />
          </View>
        </Reveal>
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    identity: { alignItems: 'center', gap: theme.space.xs, paddingVertical: theme.space.xl },
    logo: { width: 64, height: 64, borderRadius: theme.radius.lg },
    name: { ...theme.type.display, fontSize: 30, lineHeight: 34, color: theme.color.ink, marginTop: theme.space.md },
    email: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    membership: { ...theme.type.label, color: theme.color.inkFaint, marginTop: theme.space.sm },
    body: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    signOut: { gap: theme.space.md },
    blockout: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingVertical: theme.space.md },
    blockoutRange: { ...theme.type.numeric, color: theme.color.ink },
    blockoutReason: { ...theme.type.bodySmall, color: theme.color.inkMuted, marginTop: 2 },
    blockoutActions: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs },
  });
