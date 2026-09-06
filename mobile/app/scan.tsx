import { useEffect, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  STORAGE_BUCKETS,
  parseChordPro,
  renderLineAsText,
  type ChordSheetImportRow,
} from '@service-center/shared';
import { api } from '../src/lib/api';
import { supabase } from '../src/lib/supabase';
import { base64ToBytes } from '../src/lib/base64';
import { useAuth } from '../src/providers/AuthProvider';
import { Button, Card, ErrorNotice, Loading, SectionTitle } from '../src/components/ui';
import { theme } from '../src/lib/theme';

/**
 * Phase 2 on mobile: photograph a chord sheet, upload it, watch it transcribe,
 * correct the result and save it as a song.
 */
export default function ScanScreen() {
  const { organizationId, isAdmin } = useAuth();
  const router = useRouter();
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
    onSuccess: (result) => {
      router.replace(`/song/${result.song.id}`);
    },
  });

  const pick = async (source: 'camera' | 'library') => {
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

  const parsed = chordpro ? parseChordPro(chordpro) : null;
  const status = record.data?.status;

  if (!isAdmin) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Card style={styles.card}>
          <SectionTitle>Admins only</SectionTitle>
          <Text style={styles.muted}>
            Importing a chord sheet runs it through an AI transcription service, so it is limited to
            organization owners and admins.
          </Text>
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {!importId && (
        <Card style={styles.card}>
          <SectionTitle>Import a chord sheet</SectionTitle>
          <Text style={styles.muted}>
            Take a photo of a chart, or pick one from your library. It’s transcribed and converted
            into a transposable chord chart.
          </Text>
          <Button
            title="Take a photo"
            onPress={() => void pick('camera')}
            loading={uploading}
            disabled={outOfQuota}
          />
          <Button
            title="Choose from library"
            variant="secondary"
            onPress={() => void pick('library')}
            loading={uploading}
            disabled={outOfQuota}
          />
          {quota.data && (
            <Text style={outOfQuota ? styles.quotaSpent : styles.muted}>
              {outOfQuota
                ? `Daily limit reached (${quota.data.limit}). More imports at ${new Date(
                    quota.data.resets_at,
                  ).toLocaleString()}.`
                : `${quota.data.remaining} of ${quota.data.limit} imports left today.`}
            </Text>
          )}
          <ErrorNotice error={uploadError} />
        </Card>
      )}

      {preview && <Image source={{ uri: preview }} style={styles.preview} resizeMode="contain" />}

      {(status === 'pending' || status === 'processing') && (
        <Card style={styles.card}>
          <Loading label="Transcribing the chart…" />
        </Card>
      )}

      {status === 'failed' && (
        <Card style={styles.card}>
          <Text style={styles.failed}>{record.data?.error_message ?? 'The import failed.'}</Text>
          <Button
            title="Try again"
            onPress={() => {
              setImportId(null);
              setPreview(null);
            }}
          />
        </Card>
      )}

      {status === 'succeeded' && (
        <>
          <Card style={styles.card}>
            <SectionTitle>Song title</SectionTitle>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Song title"
              placeholderTextColor={theme.colors.textFaint}
            />
            {record.data?.confidence !== null && record.data?.confidence !== undefined && (
              <Text style={styles.muted}>
                {Math.round(record.data.confidence * 100)}% confidence
                {record.data.confidence < 0.8 ? ' — check the chords before saving.' : ''}
              </Text>
            )}
          </Card>

          <Card style={styles.card}>
            <SectionTitle>Preview</SectionTitle>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View>
                {parsed?.sections.map((section, sectionIndex) => (
                  <View key={sectionIndex} style={styles.section}>
                    {(section.label || section.type !== 'none') && (
                      <Text style={styles.sectionLabel}>{section.label ?? section.type}</Text>
                    )}
                    {section.lines.map((line, lineIndex) => {
                      const { chordRow, lyricRow } = renderLineAsText(line);
                      return (
                        <View key={lineIndex}>
                          {chordRow ? <Text style={styles.chordRow}>{chordRow}</Text> : null}
                          <Text style={styles.lyricRow}>{lyricRow || ' '}</Text>
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          </Card>

          <Card style={styles.card}>
            <SectionTitle>ChordPro source</SectionTitle>
            <TextInput
              style={[styles.input, styles.source]}
              value={chordpro}
              onChangeText={setChordpro}
              multiline
              textAlignVertical="top"
            />
          </Card>

          <ErrorNotice error={accept.error} />
          <Button
            title="Save as song"
            onPress={() => accept.mutate()}
            loading={accept.isPending}
            disabled={!title || !chordpro}
          />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16, paddingBottom: 48 },
  card: { gap: 10 },
  muted: { color: theme.colors.textMuted, fontSize: 14 },
  failed: { color: theme.colors.danger, fontSize: 14 },
  quotaSpent: { color: theme.colors.danger, fontSize: 14 },
  preview: { width: '100%', height: 220, borderRadius: theme.radius.md, backgroundColor: '#000' },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.colors.text,
  },
  source: { minHeight: 200, fontFamily: 'Courier', fontSize: 13 },
  section: { marginBottom: 14 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: theme.colors.brand,
    marginBottom: 4,
  },
  chordRow: { fontFamily: 'Courier', fontSize: 14, color: theme.colors.brand, fontWeight: '700' },
  lyricRow: { fontFamily: 'Courier', fontSize: 14, color: theme.colors.text },
});
