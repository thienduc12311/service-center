import { createElement } from 'react';
import { parseItemDetails, type ItemDetailsBlock, type ItemDetailsRun, type MessageTextStyle } from '@service-center/shared';

export interface ItemDetailsViewProps {
  /** The item's Markdown details. */
  markdown: string | null | undefined;
  className?: string;
}

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: 'text-base font-semibold text-slate-900 dark:text-white',
  2: 'text-sm font-semibold text-slate-900 dark:text-white',
  3: 'text-sm font-medium text-slate-800 dark:text-slate-100',
};

const styleClasses = (style: MessageTextStyle): string =>
  [
    style.bold && 'font-semibold',
    style.italic && 'italic',
    style.strike && 'line-through',
    style.code && 'rounded bg-slate-900/[0.06] px-1 font-mono text-[0.9em] dark:bg-white/10',
  ].filter(Boolean).join(' ');

interface RunsProps {
  runs: readonly ItemDetailsRun[];
}

interface BlockProps {
  block: ItemDetailsBlock;
}

const Runs = ({ runs }: RunsProps) => (
  <>
    {runs.map((run, index) => {
      const classes = styleClasses(run.style);
      if (run.kind === 'link') {
        return (
          <a
            key={index}
            href={run.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`break-words text-brand-700 underline underline-offset-2 hover:text-brand-800 dark:text-brand-300 ${classes}`}
          >
            {run.text}
          </a>
        );
      }
      return classes ? <span key={index} className={classes}>{run.text}</span> : <span key={index}>{run.text}</span>;
    })}
  </>
);

const Block = ({ block }: BlockProps) => {
  switch (block.kind) {
    case 'heading':
      return createElement(`h${block.level + 2}`, { className: HEADING_CLASS[block.level] }, <Runs runs={block.runs} />);
    case 'paragraph':
      return (
        <p>
          {block.lines.map((line, index) => (
            <span key={index}>
              {index > 0 && <br />}
              <Runs runs={line} />
            </span>
          ))}
        </p>
      );
    case 'list': {
      const items = block.items.map((item, index) => <li key={index}><Runs runs={item} /></li>);
      return block.ordered
        ? <ol start={block.start} className="list-decimal space-y-0.5 pl-5">{items}</ol>
        : <ul className="list-disc space-y-0.5 pl-5">{items}</ul>;
    }
  }
};

/**
 * Item details rendered from the shared Markdown subset. Built from React
 * text nodes only — never `innerHTML` — so typed markup stays literal, and
 * only http, https and mailto links are made (opened with noopener).
 * Used by the editor's Preview and by the order.
 */
export const ItemDetailsView = ({ markdown, className = '' }: ItemDetailsViewProps) => {
  const blocks = parseItemDetails(markdown);
  if (blocks.length === 0) return null;
  return (
    <div className={`space-y-2 break-words text-sm text-slate-700 dark:text-slate-300 ${className}`}>
      {blocks.map((block, index) => <Block key={index} block={block} />)}
    </div>
  );
};
