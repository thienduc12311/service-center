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
  /** Identifies the row a delivery writes, so a retry never adds a second one. */
  dedupeKey?: string | null;
  /** F09 deep links. */
  planItemId?: string | null;
  operationalMessageId?: string | null;
  conversationId?: string | null;
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
  dedupe_key: string | null;
  plan_item_id: string | null;
  operational_message_id: string | null;
  conversation_id: string | null;
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
  dedupe_key: draft.dedupeKey ?? null,
  plan_item_id: draft.planItemId ?? null,
  operational_message_id: draft.operationalMessageId ?? null,
  conversation_id: draft.conversationId ?? null,
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
  // Lock screens can be visible to anyone holding the device. Detailed plan,
  // team and person wording stays in the authenticated in-app feed.
  title: 'Service Center',
  body: 'Open the app to view a schedule update.',
  badge,
  data: {
    notification_id: row.id,
    type: row.type,
    organization_id: row.organization_id,
    plan_id: row.plan_id,
  },
});
