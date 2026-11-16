import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { api } from '../../lib/api';
import { deviceTimeZone } from '../../lib/church-platform';
import { useAuth } from '../../providers/AuthProvider';
import { useTheme } from '../../lib/useTheme';
import { Button, ErrorNotice, Field } from '../ui';

/**
 * Creating a church directly. Only offered while the platform allows
 * self-serve creation; otherwise people apply (ChurchApplicationFlow).
 */
export const CreateChurchForm = () => {
  const { t } = useTranslation('settings');
  const theme = useTheme();
  const { generation, isCurrentGeneration, refreshUser, switchOrganization } = useAuth();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const create = async (): Promise<void> => {
    const baseSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const slug = `${baseSlug.slice(0, 35)}-${Date.now().toString(36).slice(-4)}`;

    setCreating(true);
    setError(null);
    try {
      const created = await api.createOrganization({ name, slug, timezone: deviceTimeZone() });
      if (!isCurrentGeneration(generation)) return;
      setName('');
      await refreshUser();
      // A first church is entered by the refresh itself (a new generation).
      if (!isCurrentGeneration(generation)) return;
      await switchOrganization(created.id);
    } catch (createError) {
      if (isCurrentGeneration(generation)) setError(createError);
    } finally {
      if (isCurrentGeneration(generation)) setCreating(false);
    }
  };

  return (
    <View style={{ gap: theme.space.lg }}>
      <Field
        label={t('organization.new')}
        value={name}
        onChangeText={setName}
        placeholder={t('profile.organizations.namePlaceholder')}
      />
      <ErrorNotice error={error} />
      <Button
        title={t('organization.create')}
        icon="plus"
        onPress={() => void create()}
        loading={creating}
        disabled={name.trim().length < 2}
      />
    </View>
  );
};
