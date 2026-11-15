const { version: VERSION } = require('../package.json');
// Apple requires a unique integer-ish build number per submission. Derive it
// deterministically from VERSION (e.g. "1.02.05" -> "10205") so it always
// changes in lockstep with the version bump scripts, with no separate value to track.
const BUILD_NUMBER = VERSION.split('.')
  .map((n) => n.padStart(2, '0'))
  .join('')
  .replace(/^0+/, '');

const { withEntitlementsPlist } = require('expo/config-plugins');

/**
 * Follow-up reminders are local notifications, which need no push capability. expo-notifications
 * adds the remote-push entitlement regardless, and the App Store provisioning profile does not
 * include Push Notifications, so the archive fails to sign. Strip it.
 */
const withoutPushEntitlement = (config) =>
  withEntitlementsPlist(config, (c) => {
    delete c.modResults['aps-environment'];
    return c;
  });

module.exports = {
  expo: {
    name: 'RoloAI',
    slug: 'roloai',
    version: VERSION,
    orientation: 'portrait',
    icon: './assets/icon.png',
    // Follows the system appearance. Every colour in the app is a semantic system colour.
    userInterfaceStyle: 'automatic',
    scheme: 'roloai',
    ios: {
      bundleIdentifier: 'com.roloai.mobile',
      buildNumber: BUILD_NUMBER,
      supportsTablet: false,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSCameraUsageDescription:
          'RoloAI uses the camera to photograph business cards and scan QR codes so it can save contact details.',
      },
      // Must match the App Store privacy label (docs/app-store-privacy.md). The accessed-API
      // reasons are the ones prebuild generated before this was set, listed so none are lost.
      privacyManifests: {
        NSPrivacyTracking: false,
        NSPrivacyAccessedAPITypes: [
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
        ],
        NSPrivacyCollectedDataTypes: [
          'NSPrivacyCollectedDataTypeName',
          'NSPrivacyCollectedDataTypeEmailAddress',
          'NSPrivacyCollectedDataTypePhoneNumber',
          'NSPrivacyCollectedDataTypePhysicalAddress',
          'NSPrivacyCollectedDataTypeContacts',
          'NSPrivacyCollectedDataTypePhotosorVideos',
          'NSPrivacyCollectedDataTypeOtherUserContent',
          'NSPrivacyCollectedDataTypePreciseLocation',
          'NSPrivacyCollectedDataTypeUserID',
        ].map((type) => ({
          NSPrivacyCollectedDataType: type,
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        })),
      },
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      withoutPushEntitlement,
      // Scanning never records audio, so no microphone prompt or purpose string.
      ['expo-camera', { microphonePermission: false, recordAudioAndroid: false }],
      'expo-sharing',
      'expo-image',
      [
        'expo-contacts',
        {
          contactsPermission:
            'RoloAI adds the people whose cards you scan to Contacts when you ask it to.',
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission: 'RoloAI reads business cards from photos you choose.',
          microphonePermission: false,
        },
      ],
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'RoloAI records where you scan a card so you can remember where you met. This is used only if you turn it on in Settings.',
          // When-In-Use only. Unused purpose strings with placeholder text are a review flag.
          locationAlwaysAndWhenInUsePermission: false,
          locationAlwaysPermission: false,
          motionUsagePermission: false,
        },
      ],
      [
        'expo-quick-actions',
        {
          iosActions: [
            { id: 'scan', title: 'Scan Card', icon: 'symbol:camera.viewfinder' },
            { id: 'mycard', title: 'My Card', icon: 'symbol:qrcode' },
          ],
        },
      ],
    ],
    extra: {
      eas: {
        projectId: 'bda18c22-85c2-4d1b-b89e-066d31810f77',
      },
    },
  },
};
