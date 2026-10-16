import { ServiceCenterApi, type ApiRequestContext } from '@service-center/shared';
import { env } from './env';

export interface NativeRequestMetadata extends Readonly<Record<string, unknown>> {
  generation: number;
  userId: string | null;
}

export interface NativeApiRequestContext extends ApiRequestContext {
  metadata: NativeRequestMetadata;
}

type UnauthorizedHandler = (context: NativeApiRequestContext) => void;

let requestContext: NativeApiRequestContext = {
  accessToken: null,
  organizationId: null,
  metadata: { generation: 0, userId: null },
};
let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Replace the complete request identity in one synchronous write. */
export const setApiRequestContext = (context: NativeApiRequestContext): void => {
  requestContext = context;
};

/** Each API call receives its own immutable snapshot. */
export const getApiRequestContext = (): NativeApiRequestContext => ({
  ...requestContext,
  metadata: { ...requestContext.metadata },
});

export const setUnauthorizedHandler = (handler: UnauthorizedHandler | null): void => {
  unauthorizedHandler = handler;
};

export const api = new ServiceCenterApi({
  baseUrl: env.apiUrl,
  getRequestContext: getApiRequestContext,
  onUnauthorized: (context) => {
    unauthorizedHandler?.(context as NativeApiRequestContext);
  },
});
