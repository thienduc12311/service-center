import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, Text, View } from 'react-native';
import type { DisabledOrganization } from '@service-center/shared';
import { env } from '../../lib/env';
import type { Theme } from '../../lib/theme';
import { useTheme, useThemedStyles } from '../../lib/useTheme';
import { Icon } from '../icons';

export interface DisabledChurchNoticeProps {
  organization: DisabledOrganization;
}

/**
 * A church a super admin disabled: its members are suspended, nothing is
 * deleted. Owners also see the reason (the server sends it only to them).
 */
export const DisabledChurchNotice = ({ organization }: DisabledChurchNoticeProps) => {
  const { t } = useTranslation('settings');
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const church = organization.organization_name;
  return (
    <View accessibilityRole="alert" style={styles.notice}>
      <Icon name="ban" size={20} color={theme.accent.red.fg} />
      <View style={styles.text}>
        <Text style={styles.title}>{t('disabledChurch.title', { church })}</Text>
        <Text style={styles.body}>{t('disabledChurch.body', { church })}</Text>
        {organization.disabled_reason ? (
          <Text style={styles.body}>{t('disabledChurch.reason', { reason: organization.disabled_reason })}</Text>
        ) : null}
        <Text
          style={styles.body}
          accessibilityRole="link"
          onPress={() => void Linking.openURL(`mailto:${env.supportEmail}`)}
        >
          {t('disabledChurch.contact', { email: env.supportEmail })}
        </Text>
      </View>
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    notice: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.space.md,
      backgroundColor: theme.accent.red.bg,
      borderRadius: theme.radius.lg,
      padding: theme.space.lg,
    },
    text: { flex: 1, gap: theme.space.xs },
    title: { ...theme.type.heading, color: theme.accent.red.fg },
    body: { ...theme.type.bodySmall, color: theme.accent.red.fg },
  });
