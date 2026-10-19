import { useState } from 'react';
import { formatDateTime, formatFileSize, type FileSummary } from '@service-center/shared';
import { useFileDetail } from '../../hooks/queries';
import { Button, ErrorNotice, Loading, Modal } from '../ui';
import { fileErrorMessage, openFileVersion } from './fileActions';

export interface FileVersionsModalProps {
  file: FileSummary;
  onClose: () => void;
}

/** Versions the caller may open (writers: every version; others: current and pinned) and where the file is used. */
export const FileVersionsModal = ({ file, onClose }: FileVersionsModalProps) => {
  const detail = useFileDetail(file.id);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal open title={`Versions of ${file.title}`} onClose={onClose}>
      {detail.isLoading && <Loading />}
      <ErrorNotice error={detail.error} />
      {detail.data && (
        <>
          <ul className="divide-y divide-slate-100 text-sm">
            {detail.data.versions.map((version) => (
              <li key={version.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="font-medium">
                    v{version.version_number} {version.is_current && <span className="text-xs text-brand-700">(current)</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {version.filename} · {formatFileSize(version.size_bytes)} · {version.finalized_at ? formatDateTime(version.finalized_at) : ''}
                  </p>
                </div>
                {file.kind === 'upload' && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setError(null);
                      openFileVersion(file, { versionId: version.id }).catch((cause: unknown) => setError(fileErrorMessage(cause)));
                    }}
                  >
                    Open
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {detail.data.links.length > 0 && (
            <p className="mt-4 text-xs text-slate-500">
              Used on {detail.data.links.length} plan{detail.data.links.length === 1 ? '' : 's'}
              {detail.data.links.some((link) => link.pinned_version_id) ? ', some pinned to an earlier version' : ''}.
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-rose-700">
              {error}
            </p>
          )}
        </>
      )}
    </Modal>
  );
};
