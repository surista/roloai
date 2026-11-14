import { PlatformColor } from 'react-native';

/**
 * iOS semantic system colours. Every colour in the app comes from here rather than a hex value:
 * these resolve per appearance (light/dark), per contrast setting (Increase Contrast), and per
 * elevation (a sheet's background is not the screen's), which a hard-coded palette cannot do.
 *
 * https://developer.apple.com/design/human-interface-guidelines/color#iOS-iPadOS-system-colors
 */
export const colors = {
  label: PlatformColor('label'),
  secondaryLabel: PlatformColor('secondaryLabel'),
  tertiaryLabel: PlatformColor('tertiaryLabel'),
  placeholder: PlatformColor('placeholderText'),
  background: PlatformColor('systemBackground'),
  secondaryBackground: PlatformColor('secondarySystemBackground'),
  groupedBackground: PlatformColor('systemGroupedBackground'),
  cell: PlatformColor('secondarySystemGroupedBackground'),
  separator: PlatformColor('separator'),
  fill: PlatformColor('systemFill'),
  tertiaryFill: PlatformColor('tertiarySystemFill'),
  tint: PlatformColor('systemBlue'),
  destructive: PlatformColor('systemRed'),
  success: PlatformColor('systemGreen'),
  warning: PlatformColor('systemOrange'),
  /** Text on a tinted (filled) button. White in both appearances, as on system filled buttons. */
  onTint: '#ffffff',
} as const;

/**
 * The iOS type ramp at the default (Large) content size, in points. React Native scales Text by
 * the user's Dynamic Type setting on its own; these keep the base sizes on Apple's ramp so the
 * app reads as the same family as the system UI.
 *
 * https://developer.apple.com/design/human-interface-guidelines/typography#Specifications
 */
export const type = {
  largeTitle: { fontSize: 34, fontWeight: '700' },
  title2: { fontSize: 22, fontWeight: '700' },
  title3: { fontSize: 20, fontWeight: '600' },
  headline: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 17 },
  callout: { fontSize: 16 },
  subheadline: { fontSize: 15 },
  footnote: { fontSize: 13 },
  caption: { fontSize: 12 },
} as const;
