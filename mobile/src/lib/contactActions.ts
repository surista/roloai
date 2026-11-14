import { ActionSheetIOS, Alert, Linking } from 'react-native';
import { Contact } from 'expo-contacts';
import {
  mailtoUrl,
  mapsUrl,
  smsUrl,
  telUrl,
  websiteUrl,
  type Card,
} from '@roloai/shared';
import { haptics } from './haptics';

/**
 * Acting on a card: call, message, mail, map, browse, and save to the system Contacts app.
 */

export async function openUrl(url: string | undefined): Promise<void> {
  if (!url) return;
  try {
    await Linking.openURL(url);
  } catch {
    // tel: on an iPad without calling, or a mail link with Mail deleted.
    Alert.alert('Can’t Open', 'No app on this device can open that.');
  }
}

/** When a card has several numbers, let the owner choose, as Contacts' call button does. */
function choose<T>(title: string, items: T[], labelOf: (item: T) => string): Promise<T | undefined> {
  if (items.length <= 1) return Promise.resolve(items[0]);
  return new Promise((resolve) => {
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: [...items.map(labelOf), 'Cancel'], cancelButtonIndex: items.length },
      (i) => resolve(items[i])
    );
  });
}

export async function call(card: Card): Promise<void> {
  const phone = await choose('Call', card.phones, (p) => `${p.label}  ${p.number}`);
  if (phone) await openUrl(telUrl(phone.number));
}

export async function message(card: Card): Promise<void> {
  const phone = await choose('Message', card.phones, (p) => `${p.label}  ${p.number}`);
  if (phone) await openUrl(smsUrl(phone.number));
}

export async function email(card: Card): Promise<void> {
  const address = await choose('Email', card.emails, (e) => `${e.label}  ${e.address}`);
  if (address) await openUrl(mailtoUrl(address.address));
}

export const openWebsite = (card: Card) => openUrl(card.website ? websiteUrl(card.website) : undefined);
export const openMap = (card: Card) => openUrl(card.address ? mapsUrl(card.address) : undefined);

/**
 * Opens the system "New Contact" sheet prefilled from the card, so the owner reviews it in
 * Apple's own UI and saves (or cancels) there. CNContactViewController for a new contact runs
 * out of process, so it needs no Contacts permission.
 */
export async function addToContacts(card: Card): Promise<void> {
  try {
    const created = await Contact.presentCreateForm({
      givenName: card.firstName || undefined,
      familyName: card.lastName || undefined,
      company: card.company,
      jobTitle: card.jobTitle,
      phones: card.phones.map((p) => ({ label: p.label, number: p.number })),
      emails: card.emails.map((e) => ({ label: e.label, address: e.address })),
      urlAddresses: card.website ? [{ label: 'homepage', url: websiteUrl(card.website) ?? card.website }] : undefined,
      addresses: card.address ? [{ label: 'work', street: card.address }] : undefined,
      note: [card.event && `Met at: ${card.event}`, card.metPlace && `Where: ${card.metPlace}`, card.notes]
        .filter(Boolean)
        .join('\n') || undefined,
    });
    if (created) haptics.success();
  } catch (e) {
    console.error('Add to Contacts failed:', e);
    Alert.alert('Couldn’t Open Contacts', 'Try again in a moment.');
  }
}
