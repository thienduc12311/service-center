import { describe, expect, it, vi } from 'vitest';
import { ServiceCenterApi, type ApiRequestContext } from './api-client.js';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('ServiceCenterApi request context', () => {
  it('captures the token and organization atomically once per request', async () => {
    const context: ApiRequestContext = {
      accessToken: 'token-a',
      organizationId: 'organization-a',
      metadata: { generation: 4 },
    };
    const getRequestContext = vi.fn(() => context);
    const fetchImpl = vi.fn(async () => jsonResponse(200, { memberships: [] }));
    const client = new ServiceCenterApi({
      baseUrl: 'https://api.example.test',
      getRequestContext,
      fetchImpl,
    });

    await client.me();

    expect(getRequestContext).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/me',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-a',
          'X-Organization-Id': 'organization-a',
        }),
      }),
    );
  });

  it('returns the captured context with an unauthorized response', async () => {
    const context: ApiRequestContext = {
      accessToken: 'expired-token',
      organizationId: 'organization-a',
      metadata: { generation: 2 },
    };
    const onUnauthorized = vi.fn();
    const client = new ServiceCenterApi({
      baseUrl: 'https://api.example.test',
      getRequestContext: () => context,
      fetchImpl: async () => jsonResponse(401, { error: 'Unauthorized' }),
      onUnauthorized,
    });

    await expect(client.me()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledWith(context);
  });
});

describe('ServiceCenterApi wave 8 compatibility', () => {
  const clientWith = (fetchImpl: typeof fetch) =>
    new ServiceCenterApi({ baseUrl: 'https://api.example.test', getAccessToken: () => 'token', fetchImpl });

  it('always asks GET /conversations for a page (sends limit), so it never gets the legacy array', async () => {
    const urls: string[] = [];
    const client = clientWith(async (input) => {
      urls.push(String(input));
      return jsonResponse(200, { items: [], next_cursor: null, has_more: false });
    });
    await client.conversationsPage();
    await client.conversationsPage({ cursor: 'abc', limit: 20 });
    await client.conversations({ cursor: 'abc' });
    expect(urls.map((url) => Object.fromEntries(new URL(url).searchParams))).toEqual([
      { limit: '50' },
      { cursor: 'abc', limit: '20' },
      { cursor: 'abc', limit: '50' },
    ]);
  });

  it('treats removing an already-removed member as done (double submit)', async () => {
    const client = clientWith(async () => jsonResponse(404, { error: 'That person is not a member of this organization', code: 'not_found' }));
    await expect(client.removeMember('user-1')).resolves.toBeUndefined();
  });

  it('still surfaces other failures when removing a member', async () => {
    const client = clientWith(async () => jsonResponse(403, { error: 'Forbidden', code: 'forbidden' }));
    await expect(client.removeMember('user-1')).rejects.toMatchObject({ status: 403 });
  });
});
