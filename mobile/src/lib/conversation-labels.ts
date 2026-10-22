import type { TFunction } from 'i18next';
import type { ConversationSummary } from '@service-center/shared';
import type { Formatters } from '../i18n';

/** MOB-019: the website's conversation label — a plan chat shows its date. */
export const conversationTitle = (conversation: ConversationSummary, t: TFunction<'messages'>, format: Formatters): string =>
  conversation.kind === 'plan' && conversation.service_date
    ? t('chatPage.planConversation', { title: conversation.title, date: format.date(conversation.service_date) })
    : conversation.title;
