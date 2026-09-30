import { describe, expect, it } from 'vitest';
import { groupPairs, pairCandidates, partnerOf } from './pairing';
import { card } from './testCards';

const email = (address: string) => ({ label: 'work', address });

describe('pairing', () => {
  const ja = card({ lastName: '入江要', emails: [email('k@x.com')] });
  const en = card({ firstName: 'Kaname', lastName: 'Irie', emails: [email('k@x.com')] });
  const stranger = card({ firstName: 'Zed', lastName: 'Q', emails: [email('z@x.com')] });

  it('suggests the other-script card with a shared email', () => {
    expect(pairCandidates(ja, [ja, en, stranger]).map((c) => c.id)).toEqual([en.id]);
  });

  it('suggests by shared phone number', () => {
    const a = card({ lastName: '山田', phones: [{ label: 'work', number: '03-1234-5678' }] });
    const b = card({ firstName: 'Taro', lastName: 'Yamada', phones: [{ label: 'work', number: '+81 3 1234 5678' }] });
    expect(pairCandidates(a, [a, b])).toEqual([]); // different digits: +81 prefix
    const c = card({ firstName: 'T', phones: [{ label: 'work', number: '(03) 1234-5678' }] });
    expect(pairCandidates(a, [a, c]).map((x) => x.id)).toEqual([c.id]);
  });

  it('does not suggest same-script cards', () => {
    const twin = card({ firstName: 'Kaname', lastName: 'Irie', emails: [email('k@x.com')] });
    expect(pairCandidates(en, [en, twin])).toEqual([]);
  });

  it('only honours a mutual link', () => {
    const a = card({ lastName: '入江', pairedWith: 'nope' });
    const b = card({ firstName: 'K' });
    expect(partnerOf(a, new Map([[a.id, a], [b.id, b]]))).toBeUndefined();
    const x = card({ lastName: '入江' });
    const y = card({ firstName: 'K', pairedWith: x.id });
    x.pairedWith = y.id;
    expect(partnerOf(x, new Map([[x.id, x], [y.id, y]]))?.id).toBe(y.id);
  });

  it('groups a pair into one list entry at the first half', () => {
    const x = card({ lastName: '入江' });
    const y = card({ firstName: 'K', pairedWith: x.id });
    x.pairedWith = y.id;
    const solo = card({ firstName: 'Solo' });
    const entries = groupPairs([y, solo, x]);
    expect(entries.map((e) => e.card.id)).toEqual([y.id, solo.id]);
    expect(entries[0].partner?.id).toBe(x.id);
  });
});
