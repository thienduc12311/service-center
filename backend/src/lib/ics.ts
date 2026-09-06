export interface IcsEvent {
  uid: string;
  summary: string;
  startsAt: string | Date;
  endsAt: string | Date;
  sequence: number;
  description?: string | null;
  location?: string | null;
  status?: 'CONFIRMED' | 'CANCELLED' | 'TENTATIVE';
  dtstamp?: string | Date;
}

export interface IcsCalendarOptions {
  productId?: string;
  calendarName?: string;
  dtstamp?: string | Date;
}

const CRLF = '\r\n';

export const formatIcsUtc = (value: string | Date): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid calendar date: ${String(value)}`);
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
};

export const escapeIcsText = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');

const foldLine = (line: string): string => {
  const characters = [...line];
  const chunks: string[] = [];
  let current = '';
  let limit = 75;
  for (const character of characters) {
    const candidate = current + character;
    if (new TextEncoder().encode(candidate).length > limit && current) {
      chunks.push(current);
      current = character;
      limit = 74;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  if (chunks.length === 0) return '';
  return chunks.join(CRLF + ' ');
};

const property = (name: string, value: string): string => foldLine(`${name}:${value}`);

export const renderIcs = (events: IcsEvent[], options: IcsCalendarOptions = {}): string => {
  const dtstamp = options.dtstamp ?? new Date();
  const lines = [
    'BEGIN:VCALENDAR',
    property('PRODID', options.productId ?? '-//Service Center//Assignments//EN'),
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...(options.calendarName ? [property('X-WR-CALNAME', escapeIcsText(options.calendarName))] : []),
    ...events.flatMap((event) => [
      'BEGIN:VEVENT',
      property('UID', event.uid),
      property('DTSTAMP', formatIcsUtc(event.dtstamp ?? dtstamp)),
      property('DTSTART', formatIcsUtc(event.startsAt)),
      property('DTEND', formatIcsUtc(event.endsAt)),
      property('SEQUENCE', String(event.sequence)),
      property('SUMMARY', escapeIcsText(event.summary)),
      ...(event.description ? [property('DESCRIPTION', escapeIcsText(event.description))] : []),
      ...(event.location ? [property('LOCATION', escapeIcsText(event.location))] : []),
      ...(event.status ? [property('STATUS', event.status)] : []),
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];
  return lines.join(CRLF) + CRLF;
};
