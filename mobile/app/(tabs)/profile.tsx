import { LanguageSelector, useFormatters } from '../../src/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { avatarObjectPath, isAdmin, STORAGE_BUCKETS, type BlockoutRow } from '@service-center/shared';
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
  IconWell,
  Label,
  ListRow,
  Loading,
  Screen,
  ScreenHeader,
  SectionHeader,
  screenPadding,
  ErrorNotice,
} from '../../src/components/ui';
import { NotificationBell } from '../../src/components/NotificationBell';
import { BlockoutForm } from '../../src/components/BlockoutForm';
import { Icon, type IconName } from '../../src/components/icons';
import { PressableScale, Reveal } from '../../src/components/motion';
import { AppearanceSelector } from '../../src/components/AppearanceSelector';
import type { Accent, Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';
import { env } from '../../src/lib/env';
import { widgetsSupported } from '../../src/lib/widget-bridge';

export default function ProfileScreen() {
  const { t } = useTranslation(['settings', 'scheduling', 'people', 'teams', 'common']);
  const { calendarDate, date } = useFormatters();
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
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const queryClient = useQueryClient();

  const [fullName, setFullName] = useState(user?.profile.full_name ?? '');
  const [phone, setPhone] = useState(user?.profile.phone ?? '');
  const [newOrganizationName, setNewOrganizationName] = useState('');
  const [organizationError, setOrganizationError] = useState<unknown>(null);
  const [creatingOrganization, setCreatingOrganization] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<unknown>(null);
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
      Alert.alert(t('profile.savedTitle'), t('profile.savedMessage'));
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
      Alert.alert(t('profile.photoPermissionTitle'), t('profile.photoPermissionMessage'));
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

  /** Your own picture; it follows onto your Person, so rosters re-read too. */
  const saveAvatar = async (avatarUrl: string | null): Promise<void> => {
    await api.updateMe({ avatar_url: avatarUrl });
    if (!isCurrentGeneration(generation)) return;
    await Promise.all([
      refreshUser(),
      queryClient.invalidateQueries({ queryKey: queryKeys.teams(queryScope) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.people(queryScope) }),
    ]);
  };

  const runAvatar = async (work: () => Promise<void>): Promise<void> => {
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      await work();
    } catch (error) {
      if (isCurrentGeneration(generation)) setAvatarError(error);
    } finally {
      if (isCurrentGeneration(generation)) setAvatarBusy(false);
    }
  };

  const updateAvatar = async (): Promise<void> => {
    const userId = user?.profile.id;
    if (!userId) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!isCurrentGeneration(generation)) return;
    if (!permission.granted) {
      Alert.alert(t('profile.photoPermissionTitle'), t('profile.photoPermissionMessage'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      base64: true,
      quality: 0.85,
    });
    if (!isCurrentGeneration(generation)) return;
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) return;
    const base64 = asset.base64;

    await runAvatar(async () => {
      // The picker re-encodes an edited, compressed pick as JPEG.
      const path = avatarObjectPath({ kind: 'self', userId }, `${Date.now()}`, 'image/jpeg');
      const { error } = await supabase.storage
        .from(STORAGE_BUCKETS.avatars)
        .upload(path, base64ToBytes(base64), { contentType: 'image/jpeg' });
      if (error) throw error;
      if (!isCurrentGeneration(generation)) return;
      const { data } = supabase.storage.from(STORAGE_BUCKETS.avatars).getPublicUrl(path);
      await saveAvatar(data.publicUrl);
    });
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

  const confirmSignOut = (): void => {
    Alert.alert(
      t('about.signOutTitle'),
      t('about.signOutMessage', { email: user?.profile.email ?? '' }),
      [
        { text: t('common:actions.cancel'), style: 'cancel' },
        { text: t('common:actions.signOut'), style: 'destructive', onPress: () => void submitSignOut() },
      ],
    );
  };

  const displayName = user?.profile.full_name ?? user?.profile.email;

  return (
    <Screen safeTop>
      <ScrollView
        contentContainerStyle={[screenPadding(theme), styles.content]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <ScreenHeader
          title={t('settingsPage.title')}
          description={t('settingsPage.subtitle')}
          trailing={<NotificationBell bar={false} />}
        />

        <Reveal>
          <Card style={styles.identity}>
            <Avatar name={displayName} url={user?.profile.avatar_url} size={64} />
            <View style={styles.identityText}>
              <Text style={styles.name}>{user?.profile.full_name ?? t('profile.yourProfile')}</Text>
              <Text style={styles.email} numberOfLines={1}>{user?.profile.email}</Text>
              {organization ? (
                <View style={styles.membershipRow}>
                  {organization.logo_url ? (
                    <Image source={{ uri: organization.logo_url }} style={styles.logo} />
                  ) : (
                    <Icon name="people" size={14} color={theme.color.inkFaint} />
                  )}
                  <Text style={styles.membership}>
                    {role
                      ? t('common:format.nameWithRole', { name: organization.name, role: t(`common:roles.${role}`) })
                      : organization.name}
                  </Text>
                </View>
              ) : null}
            </View>
          </Card>
        </Reveal>

        <Reveal index={1}>
          <View style={styles.section}>
            <SectionHeader title={t('settingsPage.profile.title')} />
            <Card>
              <View style={styles.avatarRow}>
                <Avatar name={displayName} url={user?.profile.avatar_url} size={56} />
                <View style={styles.avatarActions}>
                  <Button
                    title={user?.profile.avatar_url ? t('common:avatar.change') : t('common:avatar.upload')}
                    icon="camera"
                    variant="secondary"
                    loading={avatarBusy}
                    disabled={avatarBusy}
                    onPress={() => void updateAvatar()}
                  />
                  {user?.profile.avatar_url ? (
                    <Button
                      title={t('common:avatar.remove')}
                      variant="quiet"
                      disabled={avatarBusy}
                      onPress={() => void runAvatar(() => saveAvatar(null))}
                    />
                  ) : null}
                </View>
              </View>
              <ErrorNotice error={avatarError} />
              <Field label={t('settingsPage.profile.fullName')} value={fullName} onChangeText={setFullName} placeholder={t('settingsPage.profile.fullName')} />
              <Field
                label={t('settingsPage.profile.phone')}
                value={phone}
                onChangeText={setPhone}
                placeholder={t('common:states.optional')}
                keyboardType="phone-pad"
              />
              <Text style={styles.body}>{t('settingsPage.profile.signedInAs', { email: user?.profile.email ?? '' })}</Text>
              <ErrorNotice error={save.error} />
              <Button title={t('settingsPage.profile.save')} onPress={() => save.mutate()} loading={save.isPending} />
            </Card>
          </View>
        </Reveal>

        <Reveal index={2}>
          <View style={styles.section}>
            <SectionHeader title={t('common:nav.groups.people')} />
            <Card compact style={styles.rows}>
              <SettingsRow
                icon="people"
                accent={theme.accent.blue}
                title={t('people:mobileDirectory.entry')}
                hint={t('people:mobileDirectory.entryDescription')}
                onPress={() => router.push('/people')}
              />
              <SettingsRow
                divided
                icon="person"
                accent={theme.accent.green}
                title={t('teams:mobileTeams.entry')}
                hint={t('teams:mobileTeams.entryDescription')}
                onPress={() => router.push('/teams')}
              />
              {memberships.length > 1 ? (
                <SettingsRow
                  divided
                  icon="schedule"
                  accent={theme.accent.yellow}
                  title={t('across.title')}
                  hint={t('mobileAcross.entryDescription')}
                  onPress={() => router.push('/across-organizations')}
                />
              ) : null}
            </Card>
          </View>
        </Reveal>

        <Reveal index={3}>
          <View style={styles.section}>
            <SectionHeader title={t('settingsPage.preferences.title')} />
            <Card compact style={styles.rows}>
              <SettingsRow
                icon="bell"
                accent={theme.accent.red}
                title={t('mobileNotifications.entry')}
                hint={t('mobileNotifications.entryDescription')}
                onPress={() => router.push('/notification-settings')}
              />
              <SettingsRow
                divided
                icon="calendar"
                accent={theme.accent.blue}
                title={t('settingsPage.calendar.title')}
                hint={t('scheduling:mobileSubscription.entryDescription')}
                onPress={() => router.push('/calendar-subscription')}
              />
              <SettingsRow
                divided
                icon="settings"
                accent={theme.accent.green}
                title={t('preferences.entry')}
                hint={t('preferences.entryDescription')}
                onPress={() => router.push('/team-preferences')}
              />
              <SettingsRow
                divided
                icon="download"
                accent={theme.accent.neutral}
                title={t('offlineDownloads.entry')}
                hint={t('offlineDownloads.entryDescription')}
                onPress={() => router.push('/offline-downloads')}
              />
            </Card>
            {widgetsSupported() ? (
              <Card>
                <Label>{t('mobileWidget.settingsTitle')}</Label>
                <Text style={styles.body}>{t('mobileWidget.settingsDescription')}</Text>
              </Card>
            ) : null}
          </View>
        </Reveal>

        <Reveal index={4}>
          <View style={styles.section}>
            <SectionHeader title={t('profile.appearance.title')} />
            <Card>
              <Text style={styles.body}>{t('profile.appearance.description')}</Text>
              <AppearanceSelector />
            </Card>
          </View>
        </Reveal>

        <Reveal index={4}>
          <View style={styles.section}>
            <SectionHeader title={t('common:language.bilingualLabel')} />
            <Card>
              <LanguageSelector organizationName={organization?.name} />
            </Card>
          </View>
        </Reveal>

        <Reveal index={5}>
          <View style={styles.section}>
            <SectionHeader
              title={t('blockouts.title')}
              count={visibleBlockouts.length ? visibleBlockouts.length : undefined}
            />
            <Card>
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
                        <IconWell name="calendar" accent={theme.accent.red} size={34} />
                        <View style={styles.flex}>
                          <Text style={styles.blockoutRange}>
                            {blockout.all_day
                              ? t('blockouts.occurrenceAllDay', {
                                  date: blockout.local_start_date ? calendarDate(blockout.local_start_date) : date(blockout.starts_at),
                                })
                              : blockout.local_start_time
                                ? t('blockouts.rowTimes', {
                                    date: blockout.local_start_date ? calendarDate(blockout.local_start_date) : date(blockout.starts_at),
                                    start: blockout.local_start_time.slice(0, 5),
                                    end: blockout.local_end_time?.slice(0, 5) ?? '',
                                  })
                                : t('common:format.dateRange', {
                                    start: blockout.local_start_date ? calendarDate(blockout.local_start_date) : date(blockout.starts_at),
                                    end: date(blockout.ends_at),
                                  })}
                          </Text>
                          {blockout.reason ? (
                            <Text style={styles.blockoutReason}>{blockout.reason}</Text>
                          ) : null}
                        </View>
                        {blockout.series_id ? (
                          <Button
                            title={t('profile.manageOnWebsite')}
                            variant="quiet"
                            onPress={() => void Linking.openURL(`${env.webAppDomain ? `https://${env.webAppDomain}` : 'http://localhost:5173'}/settings/blockouts/${blockout.series_id}`)}
                          />
                        ) : (
                          <View style={styles.blockoutActions}>
                            <Button title={t('common:actions.edit')} variant="quiet" onPress={() => setEditingBlockout(blockout)} />
                            <IconButton
                              name="trash"
                              accessibilityLabel={t('profile.removeBlockout', {
                                date: blockout.local_start_date ? calendarDate(blockout.local_start_date) : date(blockout.starts_at),
                              })}
                              onPress={() => removeBlockout.mutate(blockout)}
                            />
                          </View>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.body}>{t('profile.noBlockouts')}</Text>
              )}
            </Card>
          </View>
        </Reveal>

        {memberships.length > 1 ? (
          <Reveal index={6}>
            <View style={styles.section}>
              <SectionHeader title={t('common:nav.switchOrganization')} count={memberships.length} />
              <Card compact style={styles.rows}>
                {memberships.map((membership, index) => {
                  const current = membership.organization.id === organizationId;
                  return (
                    <PressableScale
                      key={membership.organization.id}
                      accessibilityLabel={membership.organization.name}
                      accessibilityState={{ selected: current }}
                      pressedOpacity={0.6}
                      onPress={() => void switchOrganization(membership.organization.id)}
                      style={[styles.orgRow, index > 0 && styles.orgRowDivided]}
                    >
                      {membership.organization.logo_url ? (
                        <Image source={{ uri: membership.organization.logo_url }} style={styles.orgLogo} />
                      ) : (
                        <Avatar name={membership.organization.name} size={36} />
                      )}
                      <Text style={[styles.orgName, current && styles.orgNameCurrent]} numberOfLines={2}>
                        {membership.organization.name}
                      </Text>
                      {current ? <Icon name="check" size={18} color={theme.color.brandText} strokeWidth={2.4} /> : null}
                    </PressableScale>
                  );
                })}
              </Card>
            </View>
          </Reveal>
        ) : null}

        <Reveal index={6}>
          <View style={styles.section}>
            <SectionHeader title={t('profile.organizations.title')} />
            <Card>
              <Text style={styles.body}>{t('profile.organizations.description')}</Text>
              {isAdmin(role) ? (
                <Button
                  title={uploadingLogo ? t('organization.uploading') : t('profile.organizations.changeLogo')}
                  icon="image"
                  variant="secondary"
                  onPress={() => void updateLogo()}
                  disabled={uploadingLogo}
                />
              ) : null}
              <Field
                label={t('organization.new')}
                value={newOrganizationName}
                onChangeText={setNewOrganizationName}
                placeholder={t('profile.organizations.namePlaceholder')}
              />
              <ErrorNotice error={organizationError} />
              <Button
                title={t('organization.create')}
                icon="plus"
                onPress={() => void createOrganization()}
                loading={creatingOrganization}
                disabled={newOrganizationName.trim().length < 2}
              />
            </Card>
          </View>
        </Reveal>

        <Reveal index={7}>
          <View style={styles.section}>
            <SectionHeader title={t('common:nav.help')} />
            <Card compact style={styles.rows}>
              <SettingsRow
                icon="person"
                accent={theme.accent.yellow}
                title={t('help.title')}
                hint={t('help.entryDescription')}
                onPress={() => router.push('/help')}
              />
              <SettingsRow
                divided
                icon="info"
                accent={theme.accent.neutral}
                title={t('about.entry')}
                hint={t('about.entryDescription')}
                onPress={() => router.push('/about')}
              />
            </Card>
          </View>
        </Reveal>

        <Reveal index={8}>
          <View style={styles.signOut}>
            <ErrorNotice error={signOutError} />
            <Button
              title={t('common:actions.signOut')}
              icon="signOut"
              variant="danger"
              loading={signingOut}
              onPress={confirmSignOut}
            />
          </View>
        </Reveal>
      </ScrollView>
    </Screen>
  );
}

interface SettingsRowProps {
  icon: IconName;
  accent: Accent;
  title: string;
  hint: string;
  onPress: () => void;
  divided?: boolean;
}

/** An iOS Settings-style row: tinted glyph, title and hint, chevron. */
const SettingsRow = ({ icon, accent, title, hint, onPress, divided = false }: SettingsRowProps) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <ListRow
      divided={divided}
      showChevron
      onPress={onPress}
      leading={<IconWell name={icon} accent={accent} size={34} />}
    >
      <Text style={styles.rowTitle}>{title}</Text>
      <Text style={styles.rowHint}>{hint}</Text>
    </ListRow>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    content: { gap: theme.space.xl },
    section: { gap: theme.space.sm },
    rows: { paddingVertical: theme.space.xs },
    identity: { flexDirection: 'row', alignItems: 'center', gap: theme.space.lg },
    identityText: { flex: 1, gap: 2 },
    logo: { width: 20, height: 20, borderRadius: theme.radius.xs },
    avatarRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    avatarActions: { flex: 1, gap: theme.space.xs },
    name: { ...theme.type.title, color: theme.color.ink },
    email: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    membershipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: theme.space.xs },
    membership: { ...theme.type.label, color: theme.color.inkMuted, flexShrink: 1 },
    body: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    rowTitle: { ...theme.type.heading, color: theme.color.ink },
    rowHint: { ...theme.type.bodySmall, color: theme.color.inkMuted, marginTop: 1 },
    orgRow: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.md,
      paddingVertical: theme.space.md,
    },
    orgRowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.border },
    orgLogo: { width: 36, height: 36, borderRadius: theme.radius.md },
    orgName: { ...theme.type.body, color: theme.color.ink, flex: 1 },
    orgNameCurrent: { fontWeight: '600' },
    signOut: { gap: theme.space.md, marginTop: theme.space.sm },
    blockout: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingVertical: theme.space.md },
    blockoutRange: { ...theme.type.numeric, color: theme.color.ink },
    blockoutReason: { ...theme.type.bodySmall, color: theme.color.inkMuted, marginTop: 2 },
    blockoutActions: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs },
  });
