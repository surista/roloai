import * as Location from 'expo-location';
import { getPreferences } from './preferences';

export interface MetPlace {
  metPlace?: string;
  metLocation?: { lat: number; lng: number };
}

/** Never let a slow GPS fix hold up a save. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);
}

/** "Shibuya, Tokyo" — the most specific two parts that exist, without repeating one. */
function describe(a: Location.LocationGeocodedAddress): string | undefined {
  const parts = [a.district ?? a.name, a.city ?? a.subregion, a.region, a.country].filter(
    (p): p is string => Boolean(p)
  );
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  return unique.slice(0, 2).join(', ') || undefined;
}

/**
 * Where the owner is right now, for a card being scanned. Empty unless location is turned on in
 * Settings *and* permission is granted — this never prompts on its own; the prompt is tied to the
 * Settings switch, so the system dialog always appears in context. Failures are silent: a card is
 * worth saving without a place.
 */
export async function captureMetPlace(): Promise<MetPlace> {
  try {
    if (!(await getPreferences()).recordLocation) return {};
    const { granted } = await Location.getForegroundPermissionsAsync();
    if (!granted) return {};
    const position =
      (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000, requiredAccuracy: 1_000 })) ??
      (await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 8_000));
    if (!position) return {};
    const { latitude, longitude } = position.coords;
    const [address] = (await withTimeout(Location.reverseGeocodeAsync({ latitude, longitude }), 5_000)) ?? [];
    return {
      metPlace: address ? describe(address) : undefined,
      metLocation: { lat: latitude, lng: longitude },
    };
  } catch (e) {
    console.warn('Could not record where the card was scanned:', e);
    return {};
  }
}

/** Asks for When-In-Use permission. Resolves whether it was granted. */
export async function requestLocationPermission(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  const result = await Location.requestForegroundPermissionsAsync();
  return { granted: result.granted, canAskAgain: result.canAskAgain };
}
