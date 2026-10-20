import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { parseFileDocument, type FileDocumentSpan, type FileSummary } from '@service-center/shared';
import { api } from '../../lib/api';
import { useFileDocument } from '../../hooks/queries';
import { Button, ErrorNotice, Loading, Modal } from '../ui';
import { fileErrorMessage } from './fileActions';

export interface DocumentModalProps {
  file: FileSummary;
  /** A pinned version to show instead of the current one. */
  versionId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const Spans = ({ spans }: { spans: FileDocumentSpan[] }) => (
  <>
    {spans.map((span, index) =>
      span.bold ? <strong key={index}>{span.text}</strong> : span.italic ? <em key={index}>{span.text}</em> : <span key={index}>{span.text}</span>,
    )}
  </>
);

/** Renders the allowlisted structure with ordinary elements; the text is never parsed as HTML. */
export const DocumentView = ({ body }: { body: string }) => (
  <div className="space-y-3 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
    {parseFileDocument(body).map((block, index) => {
      if (block.type === 'heading') {
        const size = block.level === 1 ? 'text-xl' : block.level === 2 ? 'text-lg' : 'text-base';
        return (
          <p key={index} role="heading" aria-level={block.level + 1} className={`${size} font-semibold`}>
            <Spans spans={block.spans} />
          </p>
        );
      }
      if (block.type === 'list') {
        const items = block.items.map((spans, itemIndex) => (
          <li key={itemIndex}>
            <Spans spans={spans} />
          </li>
        ));
        return block.ordered ? (
          <ol key={index} className="list-decimal pl-6">{items}</ol>
        ) : (
          <ul key={index} className="list-disc pl-6">{items}</ul>
        );
      }
      return (
        <p key={index}>
          {block.lines.map((line, lineIndex) => (
            <span key={lineIndex}>
              {lineIndex > 0 && <br />}
              <Spans spans={line} />
            </span>
          ))}
        </p>
      );
    })}
  </div>
);

export const DocumentModal = ({ file, versionId = null, onClose, onSaved }: DocumentModalProps) => {
  const { t } = useTranslation(['media', 'common']);
  const document = useFileDocument(file.id, versionId);
  const [draft, setDraft] = useState<string | null>(null);
  const [title, setTitle] = useState(file.title);
  const viewingOld = Boolean(document.data && !document.data.version.is_current);

  const save = useMutation({
    mutationFn: () => api.saveFileDocumentVersion(file.id, { title: title.trim(), body: draft ?? '', expected_revision: file.revision }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: () => onSaved(),
  });

  return (
    <Modal open size="wide" title={file.title} onClose={onClose}>
      {document.isLoading && <Loading />}
      <ErrorNotice error={document.error} />
      {document.data && draft === null && (
        <>
          <p className="mb-3 text-xs text-slate-500">
            {viewingOld
              ? t('document.versionPinned', { number: document.data.version.version_number })
              : t('document.version', { number: document.data.version.version_number })}
          </p>
          <DocumentView body={document.data.body} />
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t('common:actions.close')}
            </Button>
            {file.can_edit && !viewingOld && (
              <Button onClick={() => setDraft(document.data.body)}>{t('common:actions.edit')}</Button>
            )}
          </div>
        </>
      )}
      {draft !== null && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <label className="block">
            <span className="label">{t('addFile.title')}</span>
            <input className="input" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <textarea className="input min-h-80 font-mono text-sm" maxLength={100_000} value={draft} onChange={(event) => setDraft(event.target.value)} />
          <p className="text-xs text-slate-500">{t('document.saveHint')}</p>
          {save.error && (
            <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-600/20">
              {fileErrorMessage(save.error)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDraft(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" loading={save.isPending}>
              {t('document.saveNewVersion')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};
