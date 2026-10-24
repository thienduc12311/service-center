import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { RosterPerson } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { canOpenPeopleDetails, canOpenPerson, directoryBadges, directoryName, filterDirectory, ownPersonId } from '../../src/lib/directory';
import { useAuth } from '../../src/providers/AuthProvider';
import { Avatar, EmptyState, ErrorNotice, Field, ListRow, Loading, Screen, ScreenHeader, Tag, screenPadding } from '../../src/components/ui';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

/**
 * MOB-031: the website's People list on `listPeople`. Only the owner gets
 * contact details and can open a record; everyone else gets names, pictures
 * and campus (plus their own contact), and rows are not links — as on the
 * website. This screen shows exactly what came back.
 */
export default function DirectoryScreen() {
  const { t } = useTranslation(['people', 'common']);
  const { queryScope, user, role } = useAuth();
  const owner = canOpenPeopleDetails(role);
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [query, setQuery] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  const people = useQuery({
    queryKey: queryKeys.directory(queryScope, includeArchived),
    queryFn: () => api.listPeople(includeArchived ? { include_archived: true } : undefined),
    enabled: Boolean(queryScope),
  });
  const rows = useMemo(() => filterDirectory(people.data ?? [], query), [people.data, query]);
  const myPersonId = ownPersonId(people.data ?? [], user?.profile.id);

  const badgeLabel = { archived: t('list.archived'), inviteSent: t('list.inviteSent'), noLogin: t('list.noLogin') } as const;

  const renderRow = ({ item, index }: { item: RosterPerson; index: number }) => {
    const name = directoryName(item) ?? t('common:fallback.unnamed');
    const body = (
      <View style={styles.row}>
        <Avatar name={name} url={item.avatar_url} />
        <View style={styles.flex}>
          <Text style={styles.title}>
            {name}
            {item.person_id && item.person_id === myPersonId ? ` · ${t('mobileDirectory.you')}` : ''}
          </Text>
          {/* Contact only when the server returned it for this caller. */}
          {item.email && item.email !== name ? <Text style={styles.muted}>{item.email}</Text> : null}
          {item.phone ? <Text style={styles.muted}>{item.phone}</Text> : null}
          {item.campus ? <Text style={styles.muted}>{item.campus}</Text> : null}
          <View style={styles.tags}>
            {item.role ? <Tag label={t(`common:roles.${item.role}`)} accent={theme.accent.blue} /> : null}
            {directoryBadges(item).map((badge) => (
              <Tag key={badge} label={badgeLabel[badge]} accent={badge === 'archived' ? theme.accent.yellow : theme.accent.neutral} />
            ))}
          </View>
        </View>
      </View>
    );
    return owner && canOpenPerson(item) ? (
      <ListRow divided={index > 0} showChevron onPress={() => router.push({ pathname: '/people/[id]', params: { id: item.person_id } })}>
        {body}
      </ListRow>
    ) : (
      <ListRow divided={index > 0}>{body}</ListRow>
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('list.title') }} />
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        renderItem={renderRow}
        contentContainerStyle={screenPadding(theme)}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={people.isRefetching} onRefresh={() => void people.refetch()} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <ScreenHeader title={t('list.title')} description={t('list.subtitle')} />
            <Field
              accessibilityLabel={t('mobileDirectory.searchLabel')}
              value={query}
              onChangeText={setQuery}
              placeholder={t('mobileDirectory.searchPlaceholder')}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            <View style={styles.switchRow}>
              <Text style={[styles.body, styles.flex]}>{t('list.showArchived')}</Text>
              <Switch accessibilityLabel={t('list.showArchived')} value={includeArchived} onValueChange={setIncludeArchived} />
            </View>
            <Text style={styles.muted}>{owner ? t('mobileDirectory.privacyNote') : t('mobileDirectory.ownerOnlyNote')}</Text>
            <ErrorNotice error={people.error} />
          </View>
        }
        ListEmptyComponent={
          people.isLoading ? (
            <Loading />
          ) : people.error ? null : (
            <EmptyState title={query.trim() ? t('mobileDirectory.noMatch') : t('list.empty')} />
          )
        }
      />
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    header: { gap: theme.space.md, marginBottom: theme.space.md },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs, marginTop: theme.space.xs },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    title: { ...theme.type.body, color: theme.color.ink, fontWeight: '600' },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
  });
