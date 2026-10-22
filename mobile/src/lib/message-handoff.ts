import { Linking, Platform } from 'react-native';
import { textComposerUrl, type TextComposerPlatform } from '@service-center/shared';

/**
 * MOB-018: hands a reviewed text to the device's own messaging app. The
 * recipients, phone numbers and text come from `@service-center/shared`
 * (`textHandoffRecipients`, `textHandoffBody`); nothing here calls the API,
 * stores a number or records whether the person sent the text — the OS
 * composer never reports that reliably, and Service Center has no SMS sender.
 */

export const textComposerPlatform = (os: typeof Platform.OS): TextComposerPlatform =>
  os === 'ios' ? 'ios' : 'android';

/** Resolves false when no app on the device accepted the `sms:` link. */
export const openTextComposer = async (phones: readonly string[], text: string): Promise<boolean> => {
  try {
    await Linking.openURL(textComposerUrl(phones, text, textComposerPlatform(Platform.OS)));
    return true;
  } catch {
    return false;
  }
};
