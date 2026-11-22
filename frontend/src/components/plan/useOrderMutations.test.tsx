import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, type PlanDetail, type PlanItemDetail, type PlanItemRow } from '@service-center/shared';
import { api } from '../../lib/api';
import { keys } from '../../hooks/queries';
import { useOptimisticReorder } from './useOrderMutations';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/api', () => ({ api: { reorderPlanItems: vi.fn(), getPlan: vi.fn() } }));
vi.mock('../../providers/AuthProvider', () => ({ useAuth: () => ({ organizationId: 'org-1' }) }));

const STAMP = '2026-01-01T00:00:00Z';

const item = (id: string, title: string, sortOrder: number): PlanItemDetail => ({
  id,
  plan_id: 'plan-1',
  item_type: 'item',
  title,
  song_id: null,
  arrangement_id: null,
  key_override: null,
  length_seconds: 60,
  description: null,
  sort_order: sortOrder,
  sequence_override: null,
  leader_person_id: null,
  leader_position_id: null,
  service_segment: 'service',
  created_at: STAMP,
  updated_at: STAMP,
  song: null,
  arrangement: null,
});

const plan = {
  id: 'plan-1',
  content_revision: 5,
  items: [item('a', 'Welcome', 0), item('b', 'Sermon', 1), item('c', 'Benediction', 2)],
} as unknown as PlanDetail;

/** A request the test resolves or rejects by hand. */
interface Deferred {
  promise: Promise<PlanItemRow[]>;
  resolve: (rows: PlanItemRow[]) => void;
  reject: (error: Error) => void;
}

const deferred = (): Deferred => {
  let resolve: Deferred['resolve'] = () => {};
  let reject: Deferred['reject'] = () => {};
  const promise = new Promise<PlanItemRow[]>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(keys.plan('org-1', 'plan-1'), plan);
  // The refetch after the mutation answers with what the server holds.
  vi.mocked(api.getPlan).mockResolvedValue(plan);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useOptimisticReorder('plan-1'), { wrapper });
  const titles = () => client.getQueryData<PlanDetail>(keys.plan('org-1', 'plan-1'))!.items.map((row) => row.title);
  return { client, hook, titles };
};

afterEach(() => vi.mocked(api.reorderPlanItems).mockReset());

it('shows the new order at once and saves it with one request and the revision', async () => {
  const request = deferred();
  vi.mocked(api.reorderPlanItems).mockReturnValue(request.promise);
  const { hook, titles } = setup();

  act(() => hook.result.current.mutate({ itemIds: ['c', 'a', 'b'], revision: 5 }));
  await waitFor(() => expect(titles()).toEqual(['Benediction', 'Welcome', 'Sermon']));
  expect(api.reorderPlanItems).toHaveBeenCalledTimes(1);
  expect(api.reorderPlanItems).toHaveBeenCalledWith('plan-1', ['c', 'a', 'b'], 5);

  await act(async () => request.resolve([]));
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
});

it('puts the order back and keeps the error when the save fails', async () => {
  const request = deferred();
  vi.mocked(api.reorderPlanItems).mockReturnValue(request.promise);
  const { hook, titles } = setup();
  // The refetch fails too, so only the rollback can restore the order.
  vi.mocked(api.getPlan).mockRejectedValue(new ApiError(503, 'Down', 'server_error'));

  act(() => hook.result.current.mutate({ itemIds: ['b', 'c', 'a'], revision: 5 }));
  await waitFor(() => expect(titles()).toEqual(['Sermon', 'Benediction', 'Welcome']));

  const stale = new ApiError(409, 'This plan changed', 'plan_revision_stale');
  await act(async () => request.reject(stale));
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(hook.result.current.error).toBe(stale);
  expect(titles()).toEqual(['Welcome', 'Sermon', 'Benediction']);
});
