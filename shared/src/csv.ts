import type { Card } from './index';

/** RFC 4180 quoting: wrap when the value holds a comma, quote, or line break. */
function field(value: string): string {
  // A leading = + - @ makes spreadsheets treat the cell as a formula; a contact's notes are
  // someone else's text, so neutralise it.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const HEADER = [
  'First name',
  'Last name',
  'Job title',
  'Company',
  'Phones',
  'Emails',
  'Website',
  'Address',
  'Tags',
  'Notes',
  'Added',
];

/**
 * One row per card, for spreadsheets. Phones, emails and tags are joined with "; ".
 * The BOM is what makes Excel read the file as UTF-8 (Japanese names otherwise turn to mush).
 */
export function cardsToCsv(cards: Card[]): string {
  const rows = cards.map((card) =>
    [
      card.firstName,
      card.lastName,
      card.jobTitle ?? '',
      card.company ?? '',
      card.phones.map((p) => p.number).join('; '),
      card.emails.map((e) => e.address).join('; '),
      card.website ?? '',
      card.address ?? '',
      card.tags.join('; '),
      card.notes ?? '',
      new Date(card.createdAt).toISOString().slice(0, 10),
    ].map(field)
  );
  return '﻿' + [HEADER.map(field), ...rows].map((row) => row.join(',')).join('\r\n') + '\r\n';
}
