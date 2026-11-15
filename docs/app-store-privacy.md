# App Store privacy label

The answers for **App Store Connect → RoloAI → App Privacy**, worked out from what the app
actually stores and sends. Keep this in step with `ios.privacyManifests` in
`mobile/app.config.js`, which declares the same data types in the app's privacy manifest.

Last checked against v1.05.04.

## Where data goes

| Data | Stored in | Also sent to |
| --- | --- | --- |
| Sign-in email, account ID | Firebase Authentication | — |
| Cards (names, phones, emails, addresses, notes, tags, event, follow-up date) | Firestore | Anthropic (Claude) reads the card image and returns the text |
| Card photos | Firebase Storage | Anthropic (Claude), to read them |
| "Where we met" place and coordinates (only with the Settings switch on) | Firestore, on the card | Apple's geocoder turns the coordinates into a place name |
| My Card (your own name, title, phones, emails, address) | Firestore | — |

There is no analytics, advertising, crash reporting or tracking SDK in the iOS app. Search,
Spotlight indexing and reminders run on the device. Adding a person to Contacts writes to the
address book but never reads it.

## Answers

**Do you or your third-party partners collect data from this app?** Yes.

For **every** data type below, answer the same three questions the same way:

- **Purpose:** App Functionality (only)
- **Linked to the user's identity:** Yes
- **Used for tracking:** No

| Category | Data type | Why |
| --- | --- | --- |
| Contact Info | Name | Your own name on My Card |
| Contact Info | Email Address | Your sign-in email, and the email on My Card |
| Contact Info | Phone Number | Phone numbers on My Card |
| Contact Info | Physical Address | Address on My Card |
| Contacts | Contacts | The library of people whose cards you scan |
| User Content | Photos or Videos | Card photos, kept so you can see the original card |
| User Content | Other User Content | Notes, tags, events and follow-up dates |
| Location | Precise Location | Coordinates of where you met, only if you turn it on in Settings |
| Identifiers | User ID | The Firebase account ID your cards are filed under |

**Don't select:** Health & Fitness, Financial Info, Sensitive Info, Browsing History, Search
History (search stays on the device), Coarse Location, Usage Data, Diagnostics, Purchases,
Device ID, Other Data.

**Tracking:** No. Nothing is shared with data brokers or used for advertising, so the app does
not show the App Tracking Transparency prompt.

## Before a public App Store submission

These aren't part of the label, but App Review will look for them:

1. **Privacy policy URL.** Required for every app, in App Store Connect and reachable from inside
   the app. There isn't one yet. A page on the web app (`/privacy`) linked from Settings would
   cover both.
2. **Consent before sending card photos to a third-party AI (Guideline 5.1.2(i)).** Since
   November 2025 Apple requires apps to say clearly when personal data goes to a third-party
   AI, and to get explicit permission first. Card photos and their text go to Anthropic's
   Claude, so the app needs a one-time explanation with Allow / Not Now before the first card
   is read, and the privacy policy should name Anthropic.
3. **Sign-in for the reviewer.** Firestore rules admit only the owner's account, so App Review
   needs a demo account or a rule change. Otherwise every screen past sign-in is unreachable to
   them.

None of these matter for TestFlight testing by the owner.
