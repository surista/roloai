# RoloAI

A personal replacement for CamCard: scan business cards on iPhone with automatic edge detection and cropping (Apple's document scanner, front and optionally back), have Claude read the card and extract structured contact details, review/correct on device, and store everything in Firebase. A companion web app lets you search, view, and edit everything from a browser.

## Architecture

```
roloai/
  mobile/     Expo (React Native + TypeScript), iOS only — capture flow
  web/        Vite + React + TypeScript — view/search/edit
  shared/     Shared TypeScript Card type, used by both apps
  functions/  Firebase Cloud Function — proxies card image(s) to Claude, holds the Anthropic API key server-side
```

Both apps talk directly to Firebase (Firestore + Storage + Auth) — no custom backend server, except the one Cloud Function that has to exist because the Anthropic API key can't live in a client app bundle (it's extractable from any shipped binary).

Firebase project: **roloai-be1891** — [console](https://console.firebase.google.com/project/roloai-be1891/overview)

## One-time Firebase setup

Done already:
- Project `roloai-be1891` created, with a Web app and an iOS app (`com.roloai.mobile`) registered.
- Firestore database provisioned and `firestore.rules` deployed (owner-only on the `cards` collection, everything else denied).
- Blaze plan active, Cloud Storage bucket provisioned, and `storage.rules` deployed (owner-only on `cards/{cardId}/{fileName}`).

Also done: Email/Password sign-in is enabled, and the one user account is created. The backend is fully live.

## Access control

This is a single-user app, and "signed in" is not by itself a meaningful gate — the Firebase client API key is public (extractable from the shipped iOS binary and the web bundle), and Firebase Email/Password lets anyone holding it self-register an account. So `firestore.rules`, `storage.rules`, and the `extractCard` function all check the caller's email against the one owner account rather than just `request.auth != null`. Changing the owner account means updating all three.

Belt and braces: also turn off self-registration in the console (Authentication → Settings → User actions → *Enable create*), since the app never needs to create accounts at runtime.

Rules changes only take effect once deployed:

```
firebase deploy --only firestore:rules,storage --project roloai-be1891
```

## Card capture

Tapping "Scan Card" launches Apple's built-in document scanner (VisionKit's `VNDocumentCameraViewController`, via `react-native-document-scanner-plugin`) — the same tech behind the Notes app's "Scan Documents" feature. It detects the card's edges live, lets you adjust corners if needed, and returns an already perspective-corrected, cropped image. No custom edge-detection code to maintain.

VisionKit's scanner auto-captures continuously (it's built for multi-page documents) and keeps firing for as long as it can see a card, so one session normally returns several shots of the same card. On iOS there's no way to change that: `maxNumDocuments` is Android-only, and `VNDocumentCameraViewController` exposes no per-capture delegate callback — it reports back only once the user taps **Save**, so nothing can intercept an individual shot.

`useScanWithReview` (`mobile/src/lib/useScanWithReview.tsx`) turns that into a feature instead of an annoyance: after the session ends it shows *every* captured shot as a swipeable strip with Retake / Use This, so the repeated auto-capture becomes a choice of takes and nothing is saved without confirmation. (Before, only the first shot was kept and the rest were silently discarded.) Retake reopens the native scanner and replaces the batch. Both the initial scan flow and the retake-on-a-saved-card flow share this hook.

On an already-saved card, the "Retake" / "Add Photo" controls next to Front/Back in the mobile app relaunch the same scanner for just that side — it replaces the image in Storage/Firestore (deleting the old file) without touching the text fields, since a photo retake shouldn't silently overwrite edits you've already made to the extracted details.

## Card extraction (Cloud Function)

Scanning a card sends the photo(s) to the `extractCard` callable function (`functions/src/index.ts`), which calls Claude (`claude-sonnet-5`, vision + structured outputs) to read the card and return the parsed fields directly — no on-device OCR or regex guessing. When both a front and back photo are captured (common for bilingual cards, e.g. English/Japanese), both images go in one request so Claude can merge them into a single coherent record instead of parsing each side independently.

The function requires the caller to be signed in (`request.auth`) and reads the Anthropic key from a Firebase Functions secret, never from client code:

```
firebase functions:secrets:set ANTHROPIC_API_KEY --project roloai-be1891   # run once, prompts for the key (hidden input)
firebase deploy --only functions --project roloai-be1891                   # after any change to functions/src
```

`firebase functions:secrets:get ANTHROPIC_API_KEY` confirms a secret is set without printing its value.

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

Build with a custom dev client (same pattern as the `journal` project). This account is on the EAS free plan, so builds must always run with `--local`.

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

Multi-user accounts, Android, offline/on-device OCR fallback, and Contacts/CRM export were intentionally left out of this build to keep it focused on replacing CamCard's scan-and-store loop. See the plan history for rationale if any of these come up later.
