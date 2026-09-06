import { Linking, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { parseChordPro, renderLineAsText } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { Button, Card, ErrorNotice, Loading } from '../../src/components/ui';

export default function SongbookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const book = useQuery({ queryKey: ['songbook', id], queryFn: () => api.getSongbook(id!), enabled: Boolean(id) });
  if (book.isLoading) return <Loading label="Opening song book…" />;
  if (book.error || !book.data) return <ErrorNotice error={book.error ?? new Error('Song book not found')} />;
  return <ScrollView className="flex-1 bg-slate-50 dark:bg-slate-950" contentContainerClassName="gap-4 p-4 pb-12">
    <View><Text className="text-2xl font-bold text-slate-950 dark:text-white">{book.data.title}</Text>{book.data.description ? <Text className="mt-1 text-slate-500 dark:text-slate-400">{book.data.description}</Text> : null}</View>
    {book.data.source_type === 'document' ? <Card className="items-center gap-3 p-8"><Text className="text-4xl">▤</Text><Text className="font-semibold text-slate-900 dark:text-white">{book.data.source_filename}</Text><Button title="Open document" onPress={() => { if (book.data?.document_url) void Linking.openURL(book.data.document_url); }} disabled={!book.data.document_url} /></Card> : book.data.items.map((item, index) => {
      const parsed = item.arrangement?.chord_chart ? parseChordPro(item.arrangement.chord_chart) : null;
      return <Card key={item.id} className="gap-4 p-5"><View><Text className="text-xs font-bold uppercase tracking-widest text-brand-600">Song {index + 1}</Text><Text className="mt-1 text-xl font-bold text-slate-950 dark:text-white">{item.song.title}</Text><Text className="text-sm text-slate-500 dark:text-slate-400">{item.song.author}{item.arrangement?.song_key ? ` · Key ${item.arrangement.song_key}` : ''}</Text></View>{parsed ? <ScrollView horizontal><View>{parsed.sections.map((section, sectionIndex) => <View key={sectionIndex} className="mb-4">{section.label ? <Text className="mb-1 text-xs font-bold uppercase text-brand-600">{section.label}</Text> : null}{section.lines.map((line, lineIndex) => { const rows = renderLineAsText(line); return <View key={lineIndex}>{rows.chordRow ? <Text className="font-mono text-sm font-bold text-brand-600">{rows.chordRow}</Text> : null}<Text className="font-mono text-sm text-slate-900 dark:text-slate-100">{rows.lyricRow || ' '}</Text></View>; })}</View>)}</View></ScrollView> : <Text className="text-sm text-slate-400">No chart has been added for this song.</Text>}</Card>;
    })}
  </ScrollView>;
}
