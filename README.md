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

Production build (for TestFlight / App Store), from the repo root — this bumps the bug/patch version, builds locally, and auto-submits to App Store Connect in one shot:

```
npm run deploy:ios
```

Note: the very first time this runs, `eas submit` won't have an existing App Store Connect app record to target (no `ascAppId` is configured in `mobile/eas.json`), so it'll prompt interactively to create one. After that first run it's fully non-interactive.

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
