import { describe, expect, it } from 'vitest';
import type { PlanDetail, PlanItemDetail } from '../types/domain.js';
import {
  renderServiceSongBookHtml,
  serviceSongBookDocumentFromPlan,
  type ServiceSongBookDocument,
} from './service-song-book.js';

const songItem = (overrides: Partial<PlanItemDetail> = {}): PlanItemDetail => ({
  id: 'item-1',
  plan_id: 'plan-1',
  item_type: 'song',
  title: 'Amazing Grace',
  song_id: 'song-1',
  arrangement_id: 'arrangement-1',
  key_override: 'D',
  length_seconds: 305,
  description: null,
  sort_order: 0,
  created_at: '2026-08-01T12:00:00.000Z',
  updated_at: '2026-08-01T12:00:00.000Z',
  song: {
    id: 'song-1',
    title: 'Amazing Grace',
    author: 'John Newton',
    copyright: 'Public domain',
    default_key: 'C',
    default_bpm: 72,
  },
  arrangement: {
    id: 'arrangement-1',
    name: 'Default Arrangement',
    song_key: 'C',
    bpm: 76,
    sequence: ['Intro', 'V1', 'C1'],
    chord_chart: '[C]Amazing [F]grace',
    chart_columns: 1,
    chart_font: null,
    chart_font_size: null,
    chart_chord_color: null,
  },
  ...overrides,
});

const plan = (items: PlanItemDetail[]): PlanDetail => ({
  id: 'plan-1',
  organization_id: 'org-1',
  service_type_id: 'service-type-1',
  title: 'Sunday Service',
  service_date: '2026-08-16T14:00:00.000Z',
  location: 'Main Auditorium',
  status: 'published',
  notes: null,
  created_by: 'user-1',
  created_at: '2026-08-01T12:00:00.000Z',
  updated_at: '2026-08-01T12:00:00.000Z',
  service_type: { id: 'service-type-1', name: 'Sunday Service', recurrence: 'weekly' },
  times: [],
  counts: {
    items: items.length,
    songs: items.filter((item) => item.item_type === 'song').length,
    confirmed: 0,
    unconfirmed: 0,
    declined: 0,
  },
  items,
  assignments: [],
  position_needs: [],
  total_length_seconds: items.reduce((sum, item) => sum + item.length_seconds, 0),
});

describe('serviceSongBookDocumentFromPlan', () => {
  it('keeps scheduled songs in order and transposes charts to their plan keys', () => {
    const header = songItem({
      id: 'header-1',
      item_type: 'header',
      title: 'Worship set',
      song_id: null,
      arrangement_id: null,
      song: null,
      arrangement: null,
    });
    const document = serviceSongBookDocumentFromPlan({
      plan: plan([header, songItem()]),
      organizationName: 'Grace Church',
    });

    expect(document.songs).toHaveLength(1);
    expect(document.songs[0]).toMatchObject({
      title: 'Amazing Grace',
      key: 'D',
      arrangementName: 'Default Arrangement',
      bpm: 76,
      sequence: ['Intro', 'V1', 'C1'],
      hasChart: true,
    });
    expect(document.songs[0]?.chordpro).toBe('[D]Amazing [G]grace');
  });

  it('retains songs without charts so the export can explain what is missing', () => {
    const document = serviceSongBookDocumentFromPlan({
      plan: plan([songItem({ arrangement: null, arrangement_id: null })]),
      organizationName: 'Grace Church',
    });

    expect(document.songs[0]).toMatchObject({
      title: 'Amazing Grace',
      key: 'D',
      hasChart: false,
      chordpro: '',
    });
  });
});

describe('renderServiceSongBookHtml', () => {
  const document = (): ServiceSongBookDocument => ({
    title: 'Sunday <Service>',
    dateLabel: 'August 16, 2026',
    organizationName: 'Grace Church',
    location: 'Main Auditorium',
    songs: serviceSongBookDocumentFromPlan({
      plan: plan([songItem()]),
      organizationName: 'Grace Church',
    }).songs,
  });

  it('renders a self-contained landscape cover followed by portrait charts', () => {
    const html = renderServiceSongBookHtml(document());

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('@page cover { size: 11in 8.5in; }');
    expect(html).toContain('@page chart { size: 8.5in 11in; }');
    expect(html).toContain('<h1>Sunday &lt;Service&gt;</h1>');
    expect(html).toContain('<h2>August 16, 2026</h2>');
    expect(html).toContain('<p>Grace Church | Main Auditorium</p>');
    expect(html).toContain('class="key-badge">D</span>');
    expect(html).toContain('Default Arrangement at 76bpm');
    expect(html).toContain('Intro, V1, C1');
    expect(html).toContain('<h1 class="chart-title">Amazing Grace [D]</h1>');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('src=');
  });

  it('prints a visible missing-chart page rather than silently dropping a song', () => {
    const missing = document();
    missing.songs = [
      {
        ...missing.songs[0]!,
        chordpro: '',
        hasChart: false,
      },
    ];

    expect(renderServiceSongBookHtml(missing)).toContain(
      'No chord chart has been added for this song.',
    );
  });

  it('continues long service orders on additional landscape pages', () => {
    const long = document();
    long.songs = Array.from({ length: 8 }, (_, index) => ({
      ...long.songs[0]!,
      title: `Song ${index + 1}`,
    }));

    const html = renderServiceSongBookHtml(long);
    expect(html.match(/class="cover-page"/g)).toHaveLength(2);
    expect(html).toContain('Song order continued');
  });
});
