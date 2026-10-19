import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, formatDuration, type PlanDetail, type PlanItemDetail } from '@service-center/shared';
import { keys, useMediaList } from '../../hooks/queries';
import { api } from '../../lib/api';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice, Loading, Modal } from '../ui';

export interface LinkMediaModalProps {
  plan: PlanDetail;
  item: PlanItemDetail;
  onClose: () => void;
}

/**
 * F14: link a reusable media bundle to a regular order item (or clear it).
 * Archived bundles are not offered; an item that already uses one keeps it
 * until someone deliberately changes it.
 */
export const LinkMediaModal = ({ plan, item, onClose }: LinkMediaModalProps) => {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const list = useMediaList({ q: query.trim() || undefined });
  const save = useMutation({
    mutationFn: (mediaId: string | null) =>
      api.setPlanItemMedia(plan.id, item.id, { media_id: mediaId, expected_revision: plan.content_revision }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.all(organizationId) });
      onClose();
    },
  });
  const stale = save.error instanceof ApiError && save.error.code === 'plan_revision_stale';

  return (
    <Modal open title={`Media for “${item.title}”`} onClose={onClose}>
      <div className="space-y-4">
        {item.media && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
            <span>
              Linked: <strong>{item.media.title}</strong>
              {item.media.archived && ' (archived)'}
            </span>
            <Button variant="secondary" loading={save.isPending && save.variables === null} onClick={() => save.mutate(null)}>
              Remove link
            </Button>
          </div>
        )}
        <label className="block">
          <span className="label">Find media</span>
          <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title" />
        </label>
        {list.isLoading ? (
          <Loading />
        ) : (list.data?.media.length ?? 0) === 0 ? (
          <p className="text-sm text-slate-500">
            No media found. <Link className="underline" to="/media">Open the media library</Link> to add some.
          </p>
        ) : (
          <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
            {list.data?.media.map((media) => (
              <li key={media.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{media.title}</span>
                  <span className="text-xs text-slate-500">
                    {[media.creator, media.duration_seconds ? formatDuration(media.duration_seconds) : null, ...media.themes]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <Button
                  variant={item.media?.id === media.id ? 'primary' : 'secondary'}
                  disabled={item.media?.id === media.id}
                  loading={save.isPending && save.variables === media.id}
                  onClick={() => save.mutate(media.id)}
                >
                  {item.media?.id === media.id ? 'Linked' : 'Link'}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {stale ? (
          <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-600/20">
            Someone else changed this plan. Close this dialog to load the latest order, then try again — nothing was saved.
          </p>
        ) : (
          <ErrorNotice error={save.error} />
        )}
      </div>
    </Modal>
  );
};
