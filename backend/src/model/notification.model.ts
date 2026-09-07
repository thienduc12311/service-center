import type { NotificationRow, NotificationType } from '@service-center/shared';

/**
 * One notification about to be written, in domain terms. Callers describe the
 * event; `toNotificationInsert` turns it into the database row.
 */
export interface NotificationDraft {
  organizationId: string;
  /** The recipient, not whoever caused the event. */
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  planId?: string | null;
  assignmentId?: string | null;
  /** Whoever triggered the event, for attribution. */
  createdBy?: string | null;
}

/** The `notifications` insert payload. */
export type NotificationInsert = {
  organization_id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  plan_id: string | null;
  assignment_id: string | null;
  created_by: string | null;
};

export const toNotificationInsert = (draft: NotificationDraft): NotificationInsert => ({
  organization_id: draft.organizationId,
  user_id: draft.userId,
  type: draft.type,
  title: draft.title,
  body: draft.body ?? null,
  plan_id: draft.planId ?? null,
  assignment_id: draft.assignmentId ?? null,
  created_by: draft.createdBy ?? null,
});

/** What a push notification carries to the device. */
export interface PushMessage {
  /** An Expo push token belonging to one device. */
  to: string;
  title: string;
  body: string;
  /** Deep-link payload the app reads when the notification is tapped. */
  data: PushPayload;
  badge?: number;
}

export interface PushPayload {
  notification_id: string;
  type: NotificationType;
  organization_id: string;
  plan_id: string | null;
}

export const toPushMessage = (
  row: NotificationRow,
  token: string,
  badge: number | undefined,
): PushMessage => ({
  to: token,
  title: row.title,
  body: row.body ?? '',
  badge,
  data: {
    notification_id: row.id,
    type: row.type,
    organization_id: row.organization_id,
    plan_id: row.plan_id,
  },
});
