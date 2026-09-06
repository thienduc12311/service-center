import { useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { STORAGE_BUCKETS } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/providers/AuthProvider';
import { Button, Card, EmptyState, ErrorNotice, Loading, SectionTitle } from '../../src/components/ui';

export default function SongbooksScreen() {
  const { organizationId, canManage } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<'manual' | 'document'>('manual');
  const [selected, setSelected] = useState<string[]>([]);
  const [document, setDocument] = useState<DocumentPicker.DocumentPickerAsset | null>(null);

  const books = useQuery({ queryKey: ['songbooks', organizationId], queryFn: () => api.listSongbooks(), enabled: Boolean(organizationId) });
  const songs = useQuery({ queryKey: ['songbook-songs', organizationId], queryFn: () => api.listSongs({ per_page: 200 }), enabled: Boolean(organizationId && creating) });

  const create = useMutation({
    mutationFn: async () => {
      let path: string | null = null;
      if (mode === 'document') {
        if (!document || !organizationId) throw new Error('Choose a document.');
        path = `${organizationId}/${Date.now()}-${document.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
        const bytes = new Uint8Array(await (await fetch(document.uri)).arrayBuffer());
        const { error } = await supabase.storage.from(STORAGE_BUCKETS.songbooks).upload(path, bytes, { contentType: document.mimeType ?? 'application/pdf' });
        if (error) throw error;
      }
      return api.createSongbook({
        title,
        source_type: mode,
        source_storage_path: path,
        source_filename: mode === 'document' ? document?.name ?? null : null,
        songs: selected.map((id) => ({ song_id: id, arrangement_id: songs.data?.data.find((song) => song.id === id)?.arrangements.find((item) => item.is_default)?.id ?? null })),
      });
    },
    onSuccess: async (book) => {
      await queryClient.invalidateQueries({ queryKey: ['songbooks', organizationId] });
      setCreating(false);
      setTitle('');
      setSelected([]);
      setDocument(null);
      router.push(`/songbooks/${book.id}`);
    },
  });

  const chooseDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'], copyToCacheDirectory: true });
    if (!result.canceled) setDocument(result.assets[0] ?? null);
  };

  if (creating) return (
    <ScrollView className="flex-1 bg-slate-50 dark:bg-slate-950" contentContainerClassName="gap-4 p-4 pb-12">
      <View className="flex-row items-center justify-between"><Text className="text-2xl font-bold text-slate-950 dark:text-white">New song book</Text><Button title="Cancel" variant="secondary" onPress={() => setCreating(false)} /></View>
      <Card className="gap-4">
        <View><SectionTitle>Title</SectionTitle><TextInput className="rounded-xl border border-slate-200 px-3 py-3 text-slate-900 dark:border-slate-700 dark:text-white" value={title} onChangeText={setTitle} placeholder="Sunday Favorites" placeholderTextColor="#94a3b8" /></View>
        <View className="flex-row rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {(['manual', 'document'] as const).map((value) => <Pressable key={value} onPress={() => setMode(value)} className={`flex-1 rounded-lg px-3 py-2 ${mode === value ? 'bg-white dark:bg-slate-700' : ''}`}><Text className={`text-center text-sm font-semibold ${mode === value ? 'text-brand-600 dark:text-brand-200' : 'text-slate-500'}`}>{value === 'manual' ? 'Choose songs' : 'Attach document'}</Text></Pressable>)}
        </View>
        {mode === 'manual' ? <View className="gap-1">{songs.data?.data.map((song) => { const active = selected.includes(song.id); return <Pressable key={song.id} onPress={() => setSelected((current) => active ? current.filter((id) => id !== song.id) : [...current, song.id])} className={`flex-row items-center rounded-xl px-3 py-3 ${active ? 'bg-brand-50 dark:bg-brand-500/15' : ''}`}><Text className={`mr-3 text-lg ${active ? 'text-brand-600' : 'text-slate-300'}`}>{active ? '●' : '○'}</Text><Text className="flex-1 font-medium text-slate-900 dark:text-white">{song.title}</Text><Text className="text-slate-400">{song.default_key}</Text></Pressable>; })}</View> : <Pressable onPress={() => void chooseDocument()} className="items-center rounded-2xl border border-dashed border-slate-300 p-8 dark:border-slate-700"><Text className="text-3xl text-brand-600">⇧</Text><Text className="mt-2 font-semibold text-slate-900 dark:text-white">{document?.name ?? 'Choose document'}</Text><Text className="text-sm text-slate-400">PDF, DOCX, or TXT</Text></Pressable>}
        <ErrorNotice error={create.error} />
        <Button title="Create song book" onPress={() => create.mutate()} loading={create.isPending} disabled={!title.trim() || (mode === 'manual' ? selected.length === 0 : !document)} />
      </Card>
    </ScrollView>
  );

  return <View className="flex-1 bg-slate-50 p-4 dark:bg-slate-950">
    {canManage && <Button title="Create song book" onPress={() => setCreating(true)} />}
    <ErrorNotice error={books.error} />
    {books.isLoading ? <Loading /> : <FlatList className="mt-4" contentContainerClassName="gap-3 pb-10" data={books.data ?? []} keyExtractor={(book) => book.id} ListEmptyComponent={<EmptyState title="No song books yet" description="Combine your songs into a collection everyone can carry." />} renderItem={({ item }) => <Pressable onPress={() => router.push(`/songbooks/${item.id}`)}><Card className="flex-row items-center gap-4"><View className="size-12 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-500/15"><Text className="text-xl text-brand-600">♫</Text></View><View className="flex-1"><Text className="text-base font-semibold text-slate-950 dark:text-white">{item.title}</Text><Text className="mt-1 text-sm capitalize text-slate-500 dark:text-slate-400">{item.source_type} song book</Text></View><Text className="text-xl text-slate-300">›</Text></Card></Pressable>} />}
  </View>;
}
