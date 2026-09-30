import { describe, expect, it } from 'vitest';
import { findDuplicates, identityKeys, isJapanese, sharedAddresses } from './dedupe';
import { card } from './testCards';

const email = (address: string) => ({ label: 'work', address });

describe('sharedAddresses', () => {
  it('flags an address printed by different people', () => {
    const cards = ['Ann', 'Bob', 'Cy'].map((firstName) =>
      card({ firstName, lastName: 'X', emails: [email('team@acme.com')] })
    );
    expect(sharedAddresses(cards).has('team@acme.com')).toBe(true);
  });

  it('flags role addresses even on one card', () => {
    expect(sharedAddresses([card({ firstName: 'A', emails: [email('Support@acme.com')] })]))
      .toEqual(new Set(['support@acme.com']));
  });

  it("does not flag one person's Japanese and English cards", () => {
    const cards = [
      card({ firstName: '', lastName: '入江要', emails: [email('k@x.com')] }),
      card({ firstName: 'Kaname', lastName: 'Irie', emails: [email('k@x.com')] }),
    ];
    expect(sharedAddresses(cards).size).toBe(0);
  });

  it('treats a reordered Latin name as the same person', () => {
    const cards = [
      card({ firstName: 'Kaname', lastName: 'Irie', emails: [email('k@x.com')] }),
      card({ firstName: 'Irie', lastName: 'Kaname', emails: [email('k@x.com')] }),
    ];
    expect(sharedAddresses(cards).size).toBe(0);
  });
});

describe('identityKeys', () => {
  it('prefers personal emails', () => {
    expect(identityKeys(card({ emails: [email('A@B.com')], firstName: 'A' }))).toEqual(['email:a@b.com']);
  });

  it('falls back to name and company, and gives a nameless card no key', () => {
    expect(identityKeys(card({ firstName: 'Ann', lastName: 'Lee', company: 'Acme' }))).toEqual([
      'name:ann lee acme',
    ]);
    expect(identityKeys(card({ company: 'Acme' }))).toEqual([]);
  });
});

describe('findDuplicates', () => {
  const saved = [
    card({ firstName: 'Ann', lastName: 'Lee', emails: [email('ann@acme.com')] }),
    card({ firstName: '', lastName: '入江要', emails: [email('k@x.com')] }),
  ];

  it('finds a saved card with the same email', () => {
    const found = findDuplicates({ firstName: 'Anne', lastName: 'Lee', emails: [email('ANN@acme.com')] }, saved);
    expect(found.map((m) => m.card.id)).toEqual([saved[0].id]);
  });

  it('ignores the card being edited', () => {
    expect(findDuplicates(saved[0], saved, saved[0].id)).toEqual([]);
  });

  it("does not call a person's English card a duplicate of their Japanese one", () => {
    const english = { firstName: 'Kaname', lastName: 'Irie', emails: [email('k@x.com')] };
    expect(findDuplicates(english, saved)).toEqual([]);
  });

  it('does not match a nameless draft', () => {
    expect(findDuplicates({ company: 'Acme' }, saved)).toEqual([]);
  });
});

it('isJapanese detects kana and kanji only', () => {
  expect(isJapanese('山田')).toBe(true);
  expect(isJapanese('ヤマダ')).toBe(true);
  expect(isJapanese('Yamada')).toBe(false);
});
