const { version: VERSION } = require('../package.json');
// Apple requires a unique integer-ish build number per submission. Derive it
// deterministically from VERSION (e.g. "1.02.05" -> "10205") so it always
// changes in lockstep with the version bump scripts, with no separate value to track.
const BUILD_NUMBER = VERSION.split('.')
  .map((n) => n.padStart(2, '0'))
  .join('')
  .replace(/^0+/, '');

module.exports = {
  expo: {
    name: 'RoloAI',
    slug: 'roloai',
    version: VERSION,
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
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
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: ['expo-camera', 'react-native-document-scanner-plugin'],
    extra: {
      eas: {
        projectId: 'bda18c22-85c2-4d1b-b89e-066d31810f77',
      },
    },
  },
};
