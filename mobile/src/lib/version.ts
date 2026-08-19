import Constants from 'expo-constants';

/**
 * The app version, as set by `scripts/version.js` in the root package.json and read from there by
 * `app.config.js` at build time. Going through the resolved Expo config rather than importing
 * package.json keeps this identical to the version iOS itself reports (and to the one shown in
 * TestFlight), instead of a second value that could drift from the built binary.
 */
export const APP_VERSION = Constants.expoConfig?.version ?? '';
