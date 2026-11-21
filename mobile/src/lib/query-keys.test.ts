import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { keepScopedData, queryKeys } from './query-keys';
import type { ProtectedQueryScope } from './session-lifecycle';

const scope: ProtectedQueryScope = { userId: 'user-1', organizationId: 'org-1', generation: 1 };

describe('mobile debounced query scope', () => {
  it.each([
    { label: 'a church change', nextScope: { ...scope, organizationId: 'org-2' } },
    { label: 'an account change', nextScope: { ...scope, userId: 'user-2' } },
    { label: 'a new generation', nextScope: { ...scope, generation: 2 } },
    { label: 'sign out', nextScope: null },
  ])('retains results only before $label', ({ nextScope }) => {
    const client = new QueryClient();
    const key = queryKeys.peoplePicker(scope, '');
    const people = ['First church fixture'];
    client.setQueryData(key, people);
    const observer = new QueryObserver<string[]>(client, { queryKey: key, enabled: false });

    observer.setOptions({
      queryKey: queryKeys.peoplePicker(scope, 'a'),
      enabled: false,
      placeholderData: keepScopedData(scope),
    });
    expect(observer.getCurrentResult().data).toEqual(people);
    expect(observer.getCurrentResult().isPlaceholderData).toBe(true);

    observer.setOptions({
      queryKey: queryKeys.peoplePicker(nextScope, 'a'),
      enabled: false,
      placeholderData: keepScopedData(nextScope),
    });
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(observer.getCurrentResult().isPlaceholderData).toBe(false);
  });
});
