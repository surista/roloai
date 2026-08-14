import React from 'react';
import {
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

/**
 * `Pressable` with the two things HIG expects that RN doesn't supply by default:
 *
 * - a pressed appearance. Unlike `TouchableOpacity`, a bare `Pressable` is visually inert on
 *   touch, which is the single most consistent "this isn't a native app" tell.
 * - a 44×44pt minimum tap target, via hitSlop for controls whose visible box is smaller
 *   (text-only buttons like "Sign out" or "Retake" are ~18pt tall on their own).
 */
export const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 } as const;

interface Props extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** Style applied on top while pressed. Defaults to a 0.6 opacity dim. */
  pressedStyle?: StyleProp<ViewStyle>;
  /** Style applied on top while disabled. Defaults to a 0.4 opacity dim. */
  disabledStyle?: StyleProp<ViewStyle>;
}

export default function Button({
  style,
  pressedStyle,
  disabledStyle,
  disabled,
  hitSlop = HIT_SLOP,
  accessibilityRole = 'button',
  ...rest
}: Props) {
  return (
    <Pressable
      {...rest}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled: !!disabled, ...rest.accessibilityState }}
      style={({ pressed }) => [
        style,
        pressed && (pressedStyle ?? styles.pressed),
        disabled && (disabledStyle ?? styles.disabled),
      ]}
    />
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
});
