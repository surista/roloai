# RoloAI

A personal replacement for CamCard: scan business cards on iPhone (on-device OCR, or QR code when the card has one), review/correct the parsed fields, and store them in Firebase. A companion web app lets you search, view, and edit everything from a browser.

## Architecture

```
roloai/
  mobile/   Expo (React Native + TypeScript), iOS only — capture flow
  web/      Vite + React + TypeScript — view/search/edit
  shared/   Shared TypeScript Card type, used by both apps
```

Both apps talk directly to Firebase (Firestore + Storage + Auth) — no custom backend server.

Firebase project: **roloai-be1891** — [console](https://console.firebase.google.com/project/roloai-be1891/overview)

## One-time Firebase setup

Done already:
- Project `roloai-be1891` created, with a Web app and an iOS app (`com.roloai.mobile`) registered.
- Firestore database provisioned and `firestore.rules` deployed (auth required on the `cards` collection, everything else denied).
- Blaze plan active, Cloud Storage bucket provisioned, and `storage.rules` deployed (auth required on `cards/{cardId}/{fileName}`).

Also done: Email/Password sign-in is enabled, and the one user account is created. The backend is fully live.

## Environment config

`mobile/.env` and `web/.env` are already populated with this project's Firebase config (API keys here are public client identifiers, not secrets — access is controlled by the security rules above, not by hiding the key). Both files are gitignored. `.env.example` in each app shows the required shape if you ever need to regenerate them:

```
firebase apps:sdkconfig WEB <web-app-id> --project roloai-be1891
firebase apps:sdkconfig IOS <ios-app-id> --project roloai-be1891
```

## Running the web app

```
npm run dev:web
```

Deploy to Firebase Hosting:

```
npm run deploy:web
```

## Running the mobile app

The OCR library (`@react-native-ml-kit/text-recognition`) is a native module, so **Expo Go won't work** — you need a custom dev client, same as the `journal` project. This account is on the EAS free plan, so builds must always run with `--local`.

First time only, build a dev client and install it on your device/simulator:

```
cd mobile
npm run build:ios:dev
```

Then for day-to-day development:

```
cd mobile
npx expo start --dev-client
```

Production build (for TestFlight / App Store), from the repo root — this bumps the bug/patch version, builds locally, then submits the resulting `.ipa` to App Store Connect:

```
npm run deploy:ios
```

(`eas build --local` and `--auto-submit` can't be combined — EAS rejects that combo — so this runs as two separate `eas build` / `eas submit` steps instead.) Fully non-interactive: the app is already registered in App Store Connect (`ascAppId` set in `mobile/eas.json`) and the distribution certificate/provisioning profile are already set up on Expo's servers from the first build.

New builds land in [TestFlight](https://appstoreconnect.apple.com/apps/6794496488/testflight/ios) under Apple's processing (~5-10 min) before they're installable, and are auto-assigned to the "Team (Expo)" internal testing group — accept the invite once from the TestFlight app or the invite email, and future builds just show up as updates.

**`EXPO_PUBLIC_*` env vars**: `eas build` (even `--local`) resolves these from EAS's own server-side environment store per build profile, *not* from `mobile/.env` — the local file only matters for `expo start`/dev-client. The Firebase config vars are already pushed to all three EAS environments (production/preview/development) via `eas env:create`; if a new `EXPO_PUBLIC_*` var is ever added, push it the same way or it'll be `undefined` in built apps (`eas env:list production` to check what's there).

## Versioning

Version format is `MAJOR.MINOR.PATCH` with minor and patch zero-padded to 2 digits (e.g. `1.01.01`), kept in sync across the root, `mobile`, and `web` `package.json` files. `mobile/app.config.js` reads the version straight from the root `package.json` and derives the iOS build number from it, so there's nothing to keep in sync by hand there.

```
npm run version:bug     # 1.01.01 -> 1.01.02 (bug fixes)
npm run version:minor   # 1.01.05 -> 1.02.01 (new features)
npm run version:major   # 1.02.05 -> 2.01.01 (breaking changes)
```

`npm run deploy:ios` runs `version:bug` automatically before building, so a normal release doesn't need a separate manual bump — reach for `version:minor` / `version:major` yourself beforehand when a release warrants it.

## Non-goals (for now)

Multi-user accounts, Android, cloud OCR fallback, and Contacts/CRM export were intentionally left out of this build to keep it focused on replacing CamCard's scan-and-store loop. See the plan history for rationale if any of these come up later.
