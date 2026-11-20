import { formatMessageText, type DiscussionMention, type MessageTextStyle } from '@service-center/shared';

/** `default` sits on a light/neutral surface; `inverse` on the author's brand-coloured bubble. */
export type MessageTextTone = 'default' | 'inverse';

export interface MessageTextProps {
  text: string;
  mentions: readonly DiscussionMention[];
  tone?: MessageTextTone;
}

const PILL = 'rounded px-0.5 font-semibold';
const PILL_TONE: Record<MessageTextTone, string> = {
  default: 'bg-brand-100 text-brand-800 dark:bg-brand-500/20 dark:text-brand-200',
  inverse: 'bg-white/20 text-white',
};
const PILL_ME = 'bg-amber-200 text-amber-950 dark:bg-amber-400/30 dark:text-amber-100';
const LINK_TONE: Record<MessageTextTone, string> = {
  default: 'text-brand-700 underline underline-offset-2 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200',
  inverse: 'text-white underline underline-offset-2',
};
const CODE_TONE: Record<MessageTextTone, string> = {
  default: 'bg-slate-900/[0.06] dark:bg-white/10',
  inverse: 'bg-white/20',
};

const styleClasses = (style: MessageTextStyle, tone: MessageTextTone): string =>
  [
    style.bold && 'font-semibold',
    style.italic && 'italic',
    style.strike && 'line-through',
    style.code && `rounded px-1 font-mono text-[0.9em] ${CODE_TONE[tone]}`,
  ].filter(Boolean).join(' ');

/**
 * Message text with its light formatting (bold, italic, strike, code), links,
 * and each `@Name` of its mentions drawn as a pill — the reader's own in amber.
 * Built from text runs only; typed markup is never rendered as HTML.
 */
export const MessageText = ({ text, mentions, tone = 'default' }: MessageTextProps) => (
  <>
    {formatMessageText(text, mentions).map((run, index) => {
      const classes = styleClasses(run.style, tone);
      if (run.kind === 'mention') {
        return (
          <span key={index} className={`${PILL} ${run.target.is_me ? PILL_ME : PILL_TONE[tone]} ${classes}`}>
            {run.text}
          </span>
        );
      }
      if (run.kind === 'link') {
        return (
          <a key={index} href={run.href} target="_blank" rel="noopener noreferrer" className={`break-all ${LINK_TONE[tone]} ${classes}`}>
            {run.text}
          </a>
        );
      }
      return classes ? <span key={index} className={classes}>{run.text}</span> : run.text;
    })}
  </>
);

/** The reader is among the people this entry mentions. */
export const mentionsMe = (mentions: readonly DiscussionMention[]): boolean => mentions.some((mention) => mention.is_me);
