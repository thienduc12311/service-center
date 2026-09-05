import { useMemo } from 'react';
import { parseChordPro, renderLineAsText, transposeChordPro } from '@service-center/shared';

/**
 * Renders ChordPro as chords-above-lyrics. Column alignment is what makes a
 * chart readable on stage, so each line is emitted as two monospace rows.
 */
export const ChordChart = ({
  chordpro,
  semitones = 0,
  prefer = 'sharps',
}: {
  chordpro: string;
  semitones?: number;
  prefer?: 'sharps' | 'flats';
}) => {
  const song = useMemo(
    () => parseChordPro(transposeChordPro(chordpro, semitones, prefer)),
    [chordpro, semitones, prefer],
  );

  if (song.sections.length === 0) {
    return <p className="text-sm text-slate-400">No chord chart yet.</p>;
  }

  return (
    <div className="space-y-5">
      {song.sections.map((section, sectionIndex) => (
        <section key={sectionIndex}>
          {(section.label || section.type !== 'none') && (
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-600">
              {section.label ?? section.type}
            </h4>
          )}
          <div className="chord-chart">
            {section.lines.map((line, lineIndex) => {
              const { chordRow, lyricRow } = renderLineAsText(line);
              return (
                <div key={lineIndex}>
                  {chordRow && <div className="font-semibold text-brand-700">{chordRow}</div>}
                  <div className="text-slate-800">{lyricRow || ' '}</div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};
