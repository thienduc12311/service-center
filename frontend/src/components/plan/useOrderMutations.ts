import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { itemsInOrder, type PlanDetail, type PlanItemRow } from '@service-center/shared';
import { api } from '../../lib/api';
import { keys, useInvalidateOrg } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';

/** One reorder: the full order and the plan revision it was computed from. */
export interface ReorderVariables {
  itemIds: string[];
  revision: number;
}

/** The plan as it was before an optimistic reorder, to roll back to. */
export interface ReorderContext {
  previous: PlanDetail | undefined;
}

export type ReorderMutation = UseMutationResult<PlanItemRow[], Error, ReorderVariables, ReorderContext>;

/**
 * Saves a new order with one request. The order shows at once (optimistic);
 * if the request fails, the plan goes back to what it was and the error stays
 * on the mutation for the page to show. Either way the plan is then refetched.
 */
export const useOptimisticReorder = (planId: string): ReorderMutation => {
  const org = useAuth().organizationId;
  const client = useQueryClient();
  const invalidate = useInvalidateOrg();
  const planKey = keys.plan(org, planId);

  return useMutation<PlanItemRow[], Error, ReorderVariables, ReorderContext>({
    mutationFn: ({ itemIds, revision }) => api.reorderPlanItems(planId, itemIds, revision),
    onMutate: async ({ itemIds }) => {
      await client.cancelQueries({ queryKey: planKey });
      const previous = client.getQueryData<PlanDetail>(planKey);
      if (previous) client.setQueryData<PlanDetail>(planKey, { ...previous, items: itemsInOrder(previous.items, itemIds) });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) client.setQueryData<PlanDetail>(planKey, context.previous);
    },
    onSettled: invalidate,
  });
};
