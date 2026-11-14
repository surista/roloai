import { useEffect } from 'react';
import { File, Paths } from 'expo-file-system';
import { StackActions, type NavigationContainerRefWithCurrent } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import { usingEmulators } from './firebase';

/**
 * Development against the local emulators only: lets a script on the Mac drive navigation by
 * writing `devroute.json` into the simulator app's Documents folder, e.g.
 * `{"n":1,"go":"navigate","screen":"CardDetail","params":{"cardId":"…"}}` or `{"n":2,"go":"back"}`.
 * (`simctl openurl` stops on a confirmation alert that can't be dismissed from a script.)
 * Bump `n` to repeat a command. Inert in release builds and in normal development.
 */
export function useDevRoute(nav: NavigationContainerRefWithCurrent<RootStackParamList>): void {
  useEffect(() => {
    if (!usingEmulators) return;
    let last: unknown;
    const timer = setInterval(() => {
      try {
        const file = new File(Paths.document, 'devroute.json');
        if (!file.exists || !nav.isReady()) return;
        const cmd = JSON.parse(file.textSync()) as {
          n: number;
          go: 'navigate' | 'replace' | 'back' | 'top';
          screen?: keyof RootStackParamList;
          params?: object;
        };
        if (cmd.n === last) return;
        last = cmd.n;
        if (cmd.go === 'back') nav.goBack();
        else if (cmd.go === 'top') nav.resetRoot({ index: 0, routes: [{ name: 'CardList' }] });
        else if (cmd.go === 'replace' && cmd.screen) nav.dispatch(StackActions.replace(cmd.screen, cmd.params));
        else if (cmd.screen) (nav.navigate as (s: string, p?: object) => void)(cmd.screen, cmd.params);
      } catch (e) {
        console.warn('devroute:', e);
      }
    }, 700);
    return () => clearInterval(timer);
  }, [nav]);
}
