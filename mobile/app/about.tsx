import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { aboutDetails } from '../src/lib/about';
import { env } from '../src/lib/env';
import { useAuth } from '../src/providers/AuthProvider';
import { Button, Card, Screen, screenPadding } from '../src/components/ui';
import type { Theme } from '../src/lib/theme';
import { useTheme, useThemedStyles } from '../src/lib/useTheme';

interface FactRowProps {
  label: string;
  value: string;
}

const FactRow = ({ label, value }: FactRowProps) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue} selectable>{value}</Text>
    </View>
  );
};

/**
 * MOB-021: factual version/build details, where to get help, and what stays
 * on the website. Nothing here is fetched; it shows what this build and
 * session already know, so it also works offline.
 */
export default function AboutScreen() {
  const { t } = useTranslation(['settings', 'common']);
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { user, organizationId } = useAuth();
  const details = useMemo(
    () =>
      aboutDetails({
        version: Constants.expoConfig?.version,
        executionEnvironment: Constants.executionEnvironment,
        apiUrl: env.apiUrl,
        webAppDomain: env.webAppDomain,
      }),
    [],
  );
  const organization = user?.memberships.find((membership) => membership.organization.id === organizationId)?.organization;
  const websiteUrl = details.websiteUrl;

  return (
    <Screen>
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.gap]}>
        <Card>
          <Text accessibilityRole="header" style={styles.heading}>{t('about.appTitle')}</Text>
          <FactRow label={t('common:app.name')} value={details.version ? `${t('about.version')} ${details.version}` : t('about.unknown')} />
          <FactRow label={t('about.build')} value={details.build === 'expo-go' ? t('about.buildExpoGo') : t('about.buildInstalled')} />
          <FactRow label={t('about.server')} value={details.server ?? t('about.unknown')} />
          {user?.profile.email ? <FactRow label={t('about.account')} value={user.profile.email} /> : null}
          {organization ? <FactRow label={t('about.organization')} value={organization.name} /> : null}
        </Card>

        <Card>
          <Text accessibilityRole="header" style={styles.heading}>{t('about.helpTitle')}</Text>
          <Text style={styles.body}>{t('about.helpBody')}</Text>
        </Card>

        <Card>
          <Text accessibilityRole="header" style={styles.heading}>{t('about.websiteTitle')}</Text>
          <Text style={styles.body}>{t('about.websiteBody')}</Text>
          {websiteUrl ? (
            <Button
              title={t('about.openWebsite')}
              variant="secondary"
              onPress={() => void Linking.openURL(websiteUrl)}
            />
          ) : (
            <Text style={styles.hint}>{t('about.websiteMissing')}</Text>
          )}
        </Card>

        <Card>
          <Text accessibilityRole="header" style={styles.heading}>{t('about.storageTitle')}</Text>
          <Text style={styles.body}>{t('about.storageBody')}</Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    gap: { gap: theme.space.lg },
    heading: { ...theme.type.heading, color: theme.color.ink },
    body: { ...theme.type.body, color: theme.color.inkMuted },
    hint: { ...theme.type.bodySmall, color: theme.color.inkFaint },
    fact: { gap: 2, paddingVertical: theme.space.xs },
    factLabel: { ...theme.type.bodySmall, color: theme.color.inkFaint },
    factValue: { ...theme.type.body, color: theme.color.ink },
  });
