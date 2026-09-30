import { expect, it } from 'vitest';
import { cardToVCard, cardsToVCard, parseVCards } from './index';
import { card } from './testCards';

it('round-trips a card, including escapes and non-Latin text', () => {
  const original = card({
    firstName: 'Ann',
    lastName: 'Lee',
    company: 'Acme, Inc.; West',
    jobTitle: 'CEO',
    phones: [{ label: 'mobile', number: '+1 555 0100' }],
    emails: [{ label: 'work', address: 'ann@acme.com' }],
    address: '1 Main St\nSuite 2',
    notes: 'Line one\nLine two, with; punctuation \\ backslash',
  });
  const [parsed] = parseVCards(cardToVCard(original));
  expect(parsed).toMatchObject({
    firstName: 'Ann',
    lastName: 'Lee',
    company: 'Acme, Inc.; West',
    address: '1 Main St\nSuite 2',
    notes: original.notes,
  });
  expect(parsed.phones[0].number).toBe('+1 555 0100');
  expect(parsed.emails[0].address).toBe('ann@acme.com');
});

it('exports several cards as one file and parses them all back', () => {
  const cards = [card({ firstName: 'A' }), card({ firstName: '入江', lastName: '要' })];
  expect(parseVCards(cardsToVCard(cards)).map((c) => c.firstName)).toEqual(['A', '入江']);
});
