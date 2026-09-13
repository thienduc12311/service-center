import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { PlanDetail } from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice, Modal } from '../ui';

export interface EditNotesModalProps {
  open: boolean;
  plan: PlanDetail;
  onClose: () => void;
}

export const EditNotesModal = ({ open, plan, onClose }: EditNotesModalProps) => {
  const invalidate = useInvalidateOrg();
  const [notes, setNotes] = useState(plan.notes ?? '');
  const [loadedPlanId, setLoadedPlanId] = useState(plan.id);

  if (loadedPlanId !== plan.id) {
    setLoadedPlanId(plan.id);
    setNotes(plan.notes ?? '');
  }

  const save = useMutation({
    mutationFn: () => api.updatePlan(plan.id, { notes: notes.trim() || null }),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });

  return (
    <Modal open={open} title="Plan notes" onClose={onClose}>
      <div className="space-y-4">
        <textarea
          className="input"
          rows={8}
          maxLength={8000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Anything the team should read before this service."
        />
        <ErrorNotice error={save.error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save notes
          </Button>
        </div>
      </div>
    </Modal>
  );
};
