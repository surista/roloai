import { expect, it } from 'vitest';
import { cardImageFileName, myCardOf, withoutMine } from './mine';
import { card } from './testCards';

it('finds my card and hides it from the library', () => {
  const me = card({ firstName: 'Me', isMine: true });
  const other = card({ firstName: 'Ann' });
  expect(myCardOf([other, me])).toBe(me);
  expect(myCardOf([other])).toBeUndefined();
  expect(withoutMine([other, me])).toEqual([other]);
});

it('names image files safely', () => {
  expect(cardImageFileName({ firstName: 'Ann', lastName: 'O/Lee' }, 'front')).toBe('Ann-OLee-front.jpg');
  expect(cardImageFileName({ firstName: '', lastName: '入江要' }, 'back')).toBe('入江要-back.jpg');
  expect(cardImageFileName({ firstName: '', lastName: '' }, 'front')).toBe('card-front.jpg');
});
