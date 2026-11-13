import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { RosterPerson } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { canOpenPeopleDetails, canOpenPerson, directoryBadges, directoryName, filterDirectory, ownPersonId } from '../../src/lib/directory';
import { useAuth } from '../../src/providers/AuthProvider';
import { Avatar, Card, EmptyState, ErrorNotice, ListRow, Loading, Screen, ScreenHeader, SectionHeader, Tag, screenPadding } from '../../src/components/ui';
import { Icon } from '../../src/components/icons';
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
        <Avatar name={name} url={item.avatar_url} size={40} />
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
    return (
      <View style={[styles.groupRow, index === 0 && styles.groupFirst, index === rows.length - 1 && styles.groupLast]}>
        {owner && canOpenPerson(item) ? (
          <ListRow divided={index > 0} showChevron onPress={() => router.push({ pathname: '/people/[id]', params: { id: item.person_id } })}>
            {body}
          </ListRow>
        ) : (
          <ListRow divided={index > 0}>{body}</ListRow>
        )}
      </View>
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('list.title') }} />
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        renderItem={renderRow}
        contentContainerStyle={[screenPadding(theme), styles.list]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={people.isRefetching} onRefresh={() => void people.refetch()} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <ScreenHeader title={t('list.title')} description={t('list.subtitle')} />
            <View style={styles.search}>
              <Icon name="search" size={17} color={theme.color.inkFaint} />
              <TextInput
                accessibilityLabel={t('mobileDirectory.searchLabel')}
                value={query}
                onChangeText={setQuery}
                placeholder={t('mobileDirectory.searchPlaceholder')}
                placeholderTextColor={theme.color.inkFaint}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                style={styles.searchInput}
              />
            </View>
            <Card compact style={styles.optionsCard}>
              <View style={styles.switchRow}>
                <Text style={[styles.body, styles.flex]}>{t('list.showArchived')}</Text>
                <Switch accessibilityLabel={t('list.showArchived')} value={includeArchived} onValueChange={setIncludeArchived} />
              </View>
              <Text style={styles.muted}>{owner ? t('mobileDirectory.privacyNote') : t('mobileDirectory.ownerOnlyNote')}</Text>
            </Card>
            <ErrorNotice error={people.error} />
            {rows.length ? <SectionHeader title={t('list.title')} count={rows.length} /> : null}
          </View>
        }
        ListEmptyComponent={
          people.isLoading ? (
            <Loading />
          ) : people.error ? null : (
            <EmptyState icon={query.trim() ? 'search' : 'people'} title={query.trim() ? t('mobileDirectory.noMatch') : t('list.empty')} />
          )
        }
      />
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    header: { gap: theme.space.lg, marginBottom: theme.space.md },
    list: { gap: 0 },
    groupRow: {
      backgroundColor: theme.color.surface,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: theme.color.border,
      paddingHorizontal: theme.space.md,
    },
    groupFirst: {
      borderTopWidth: 1,
      borderTopLeftRadius: theme.radius.lg + 2,
      borderTopRightRadius: theme.radius.lg + 2,
    },
    groupLast: {
      borderBottomWidth: 1,
      borderBottomLeftRadius: theme.radius.lg + 2,
      borderBottomRightRadius: theme.radius.lg + 2,
    },
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm,
      minHeight: 46,
      borderWidth: 1,
      borderColor: theme.color.border,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.surfaceInset,
      paddingHorizontal: theme.space.md,
    },
    searchInput: { ...theme.type.body, lineHeight: undefined, flex: 1, color: theme.color.ink, paddingVertical: theme.space.sm + 2 },
    optionsCard: { gap: theme.space.sm },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs, marginTop: theme.space.xs },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, minHeight: 44 },
    title: { ...theme.type.heading, color: theme.color.ink },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
  });
