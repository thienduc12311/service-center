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
