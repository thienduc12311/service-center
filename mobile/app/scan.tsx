import { useEffect, useMemo, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  STORAGE_BUCKETS,
  parseChordPro,
  type ChordSheetImportRow,
} from '@service-center/shared';
import { api } from '../src/lib/api';
import { supabase } from '../src/lib/supabase';
import { base64ToBytes } from '../src/lib/base64';
import { useAuth } from '../src/providers/AuthProvider';
import {
  Button,
  Card,
  ErrorNotice,
  Field,
  Label,
  Loading,
  Screen,
  Tag,
  screenPadding,
} from '../src/components/ui';
import { ChordChart } from '../src/components/ChordChart';
import { Reveal } from '../src/components/motion';
import type { Theme } from '../src/lib/theme';
import { useTheme, useThemedStyles } from '../src/lib/useTheme';

type CaptureSource = 'camera' | 'library';

/**
 * Photograph a printed chord sheet, watch it transcribe, correct the result
 * and save it as a song.
 */
export default function ScanScreen() {
  const { organizationId, isAdmin } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [preview, setPreview] = useState<string | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [chordpro, setChordpro] = useState('');
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [uploading, setUploading] = useState(false);

  // Today's allowance. Admin-only, so it is only asked for when it applies.
  const quota = useQuery({
    queryKey: ['import-quota', organizationId],
    queryFn: () => api.getImportQuota(),
    enabled: Boolean(organizationId) && isAdmin,
  });
  const outOfQuota = quota.data?.remaining === 0;

  // Poll until the OCR job settles.
  const record = useQuery({
    queryKey: ['import', importId],
    queryFn: () => api.getImport(importId!),
    enabled: Boolean(importId),
    refetchInterval: (query) => {
      const status = (query.state.data as ChordSheetImportRow | undefined)?.status;
      return status === 'pending' || status === 'processing' ? 2000 : false;
    },
  });

  useEffect(() => {
    const result = record.data;
    if (result?.status !== 'succeeded') return;
    // Seed the editable fields once, without clobbering the user's own
    // corrections on a later poll.
    setTitle((current) => current || result.detected_title || '');
    setChordpro((current) => current || result.parsed_chordpro || '');
  }, [record.data]);

  const accept = useMutation({
    mutationFn: () =>
      api.acceptImport(importId!, {
        title,
        chordpro,
        song_key: record.data?.detected_key ?? null,
        arrangement_name: 'Imported Arrangement',
      }),
    onSuccess: (result) => router.replace(`/song/${result.song.id}`),
  });

  const capture = async (source: CaptureSource): Promise<void> => {
    if (!organizationId || outOfQuota) return;

    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow access so the chord sheet can be captured.');
      return;
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({
            base64: true,
            quality: 0.8,
            mediaTypes: ['images'],
          });

    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) return;

    setPreview(asset.uri);
    setUploading(true);
    setUploadError(null);

    try {
      const path = `${organizationId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
      const { error } = await supabase.storage
        .from(STORAGE_BUCKETS.chordSheets)
        .upload(path, base64ToBytes(asset.base64), { contentType: 'image/jpeg' });
      if (error) throw error;

      const created = await api.createImport({
        storage_path: path,
        original_filename: asset.fileName ?? 'chord-sheet.jpg',
      });
      setImportId(created.id);
      await quota.refetch();
    } catch (error) {
      setUploadError(error);
    } finally {
      setUploading(false);
    }
  };

  const chart = useMemo(() => (chordpro ? parseChordPro(chordpro) : null), [chordpro]);
  const status = record.data?.status;
  const confidence = record.data?.confidence;

  if (!isAdmin) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={screenPadding(theme)}>
          <Reveal>
            <Card>
              <Label>Owners and admins only</Label>
              <Text style={styles.body}>
                Importing a chart runs it through an AI transcription service, so it is limited to
                organization owners and admins.
              </Text>
            </Card>
          </Reveal>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={screenPadding(theme)} keyboardShouldPersistTaps="handled">
        {!importId ? (
          <Reveal>
            <View style={styles.hero}>
              <Text style={styles.title}>Turn a printed chart into a transposable one.</Text>
              <Text style={styles.body}>
                Photograph a chord sheet and it comes back as text you can change key on, correct
                by hand, and save into the library.
              </Text>

              <View style={styles.captureActions}>
                <Button
                  title="Take a photo"
                  icon="camera"
                  onPress={() => void capture('camera')}
                  loading={uploading}
                  disabled={outOfQuota}
                />
                <Button
                  title="Choose from your library"
                  icon="image"
                  variant="secondary"
                  onPress={() => void capture('library')}
                  loading={uploading}
                  disabled={outOfQuota}
                />
              </View>

              {quota.data ? (
                <Tag
                  label={
                    outOfQuota
                      ? `Daily limit of ${quota.data.limit} reached`
                      : `${quota.data.remaining} of ${quota.data.limit} left today`
                  }
                  accent={outOfQuota ? theme.accent.red : theme.accent.neutral}
                />
              ) : null}
              {outOfQuota && quota.data ? (
                <Text style={styles.body}>
                  {`More imports at ${new Date(quota.data.resets_at).toLocaleString()}.`}
                </Text>
              ) : null}

              <ErrorNotice error={uploadError} />
            </View>
          </Reveal>
        ) : null}

        {preview ? (
          <Reveal index={1}>
            <Image source={{ uri: preview }} style={styles.preview} resizeMode="cover" />
          </Reveal>
        ) : null}

        {status === 'pending' || status === 'processing' ? (
          <Card>
            <Loading label="Reading the chart" />
          </Card>
        ) : null}

        {status === 'failed' ? (
          <Card>
            <ErrorNotice error={new Error(record.data?.error_message ?? 'The import failed.')} />
            <Button
              title="Try another photo"
              onPress={() => {
                setImportId(null);
                setPreview(null);
              }}
            />
          </Card>
        ) : null}

        {status === 'succeeded' ? (
          <>
            <Reveal index={2}>
              <Card>
                <Field label="Song title" value={title} onChangeText={setTitle} placeholder="Song title" />
                {typeof confidence === 'number' ? (
                  <View style={styles.confidenceRow}>
                    <Tag
                      label={`${Math.round(confidence * 100)}% confident`}
                      accent={confidence < 0.8 ? theme.accent.yellow : theme.accent.green}
                    />
                    {confidence < 0.8 ? (
                      <Text style={styles.body}>Check the chords before you save.</Text>
                    ) : null}
                  </View>
                ) : null}
              </Card>
            </Reveal>

            {chart ? (
              <Reveal index={3}>
                <View style={styles.previewBlock}>
                  <Label>How it will read</Label>
                  <ChordChart chart={chart} />
                </View>
              </Reveal>
            ) : null}

            <Reveal index={4}>
              <Card>
                <Label>ChordPro source</Label>
                <Field
                  value={chordpro}
                  onChangeText={setChordpro}
                  multiline
                  textAlignVertical="top"
                  style={styles.source}
                />
              </Card>
            </Reveal>

            <Reveal index={5}>
              <View style={styles.saveBlock}>
                <ErrorNotice error={accept.error} />
                <Button
                  title="Save to the library"
                  icon="check"
                  onPress={() => accept.mutate()}
                  loading={accept.isPending}
                  disabled={!title || !chordpro}
                />
              </View>
            </Reveal>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    hero: { gap: theme.space.lg },
    title: { ...theme.type.display, fontSize: 32, lineHeight: 36, color: theme.color.ink },
    body: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    captureActions: { gap: theme.space.md, marginTop: theme.space.sm },

    preview: {
      width: '100%',
      height: 240,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.color.border,
      backgroundColor: theme.color.surfaceInset,
    },

    confidenceRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, flexWrap: 'wrap' },
    previewBlock: { gap: theme.space.md },
    source: { ...theme.type.code, minHeight: 220 },
    saveBlock: { gap: theme.space.md },
  });
