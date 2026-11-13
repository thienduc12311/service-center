import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { aboutDetails } from '../src/lib/about';
import { env } from '../src/lib/env';
import { useAuth } from '../src/providers/AuthProvider';
import { Button, Card, IconWell, Screen, SectionHeader, screenPadding } from '../src/components/ui';
import type { IconName } from '../src/components/icons';
import type { Theme } from '../src/lib/theme';
import { useTheme, useThemedStyles } from '../src/lib/useTheme';

interface FactRowProps {
  label: string;
  value: string;
  /** Draws a hairline above the row, for rows after the first. */
  divided?: boolean;
}

const FactRow = ({ label, value, divided = false }: FactRowProps) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.fact, divided && styles.factDivided]} accessible accessibilityLabel={`${label}: ${value}`}>
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
        <View style={styles.hero}>
          <View style={styles.brandMark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={styles.brandLetters} maxFontSizeMultiplier={1}>SC</Text>
          </View>
          <Text accessibilityRole="header" style={styles.appName}>{t('common:app.name')}</Text>
          <Text style={styles.hint}>
            {details.version ? `${t('about.version')} ${details.version}` : t('about.unknown')}
          </Text>
        </View>

        <View style={styles.section}>
          <SectionHeader title={t('about.appTitle')} />
          <Card compact style={styles.facts}>
            <FactRow label={t('common:app.name')} value={details.version ? `${t('about.version')} ${details.version}` : t('about.unknown')} />
            <FactRow divided label={t('about.build')} value={details.build === 'expo-go' ? t('about.buildExpoGo') : t('about.buildInstalled')} />
            <FactRow divided label={t('about.server')} value={details.server ?? t('about.unknown')} />
            {user?.profile.email ? <FactRow divided label={t('about.account')} value={user.profile.email} /> : null}
            {organization ? <FactRow divided label={t('about.organization')} value={organization.name} /> : null}
          </Card>
        </View>

        <Card>
          <InfoHeading icon="people" title={t('about.helpTitle')} />
          <Text style={styles.body}>{t('about.helpBody')}</Text>
        </Card>

        <Card>
          <InfoHeading icon="document" title={t('about.websiteTitle')} />
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
          <InfoHeading icon="upload" title={t('about.storageTitle')} />
          <Text style={styles.body}>{t('about.storageBody')}</Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}

interface InfoHeadingProps {
  icon: IconName;
  title: string;
}

/** A card heading with a tinted glyph. */
const InfoHeading = ({ icon, title }: InfoHeadingProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.infoHeading}>
      <IconWell name={icon} accent={theme.accent.blue} size={34} />
      <Text accessibilityRole="header" style={styles.heading}>{title}</Text>
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    gap: { gap: theme.space.lg },
    section: { gap: theme.space.sm },
    hero: { alignItems: 'center', gap: theme.space.xs, paddingVertical: theme.space.lg },
    brandMark: {
      width: 64,
      height: 64,
      borderRadius: theme.radius.lg + 4,
      backgroundColor: theme.color.brand,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: theme.space.sm,
    },
    brandLetters: { ...theme.type.title, fontSize: 22, fontWeight: '700', color: theme.color.onBrand },
    appName: { ...theme.type.title, color: theme.color.ink },
    infoHeading: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    heading: { ...theme.type.heading, color: theme.color.ink, flex: 1 },
    body: { ...theme.type.body, color: theme.color.inkMuted },
    hint: { ...theme.type.bodySmall, color: theme.color.inkFaint },
    facts: { paddingVertical: theme.space.xs },
    fact: { gap: 2, paddingVertical: theme.space.sm },
    factDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.border },
    factLabel: { ...theme.type.label, fontSize: 12, color: theme.color.inkFaint },
    factValue: { ...theme.type.body, color: theme.color.ink },
  });
