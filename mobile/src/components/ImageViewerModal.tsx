import React, { useState } from 'react';
import {
  Modal,
  View,
  Image,
  ScrollView,
  Text,
  StyleSheet,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Button from './Button';

interface Props {
  visible: boolean;
  images: { uri: string; label: string }[];
  initialIndex: number;
  onClose: () => void;
}

/** How far a downward pull (at 1× zoom) dismisses the viewer, as in Photos. */
const DISMISS_PULL = 90;

/**
 * Full-screen photo viewer: swipe between sides, pinch (or double-tap) to zoom into small print,
 * pull down to dismiss. Zoom comes from UIScrollView itself via maximumZoomScale, so it has the
 * system's own feel, bounce and all.
 */
export default function ImageViewerModal({ visible, images, initialIndex, onClose }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [pageIndex, setPageIndex] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);

  const handlePage = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPageIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onShow={() => {
        setPageIndex(initialIndex);
        setZoomed(false);
      }}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <StatusBar style="light" />

        <ScrollView
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: initialIndex * width, y: 0 }}
          onMomentumScrollEnd={handlePage}
        >
          {images.map((image) => (
            <ZoomablePage
              key={image.uri}
              uri={image.uri}
              label={image.label}
              width={width}
              height={height}
              onZoomChange={setZoomed}
              onPullDown={onClose}
            />
          ))}
        </ScrollView>

        <Button
          style={[styles.closeButton, { top: insets.top + 8 }]}
          onPress={onClose}
          accessibilityLabel="Close"
        >
          <SymbolView name="xmark" size={16} weight="semibold" tintColor="#fff" />
        </Button>

        {images.length > 1 && (
          <Text style={[styles.label, { top: insets.top + 16 }]} accessibilityLiveRegion="polite">
            {images[pageIndex]?.label}
          </Text>
        )}

        {images.length > 1 && (
          <View style={[styles.dots, { bottom: insets.bottom + 24 }]} importantForAccessibility="no-hide-descendants">
            {images.map((image, i) => (
              <View key={image.uri} style={[styles.dot, i === pageIndex && styles.dotActive]} />
            ))}
          </View>
        )}
      </View>
    </Modal>
  );
}

function ZoomablePage(props: {
  uri: string;
  label: string;
  width: number;
  height: number;
  onZoomChange: (zoomed: boolean) => void;
  onPullDown: () => void;
}) {
  const ref = React.useRef<ScrollView>(null);
  const zoom = React.useRef(1);
  const lastTap = React.useRef(0);

  return (
    <ScrollView
      ref={ref}
      style={{ width: props.width, height: props.height }}
      contentContainerStyle={{ width: props.width, height: props.height }}
      maximumZoomScale={4}
      minimumZoomScale={1}
      bouncesZoom
      alwaysBounceVertical
      centerContent
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      onScroll={(e) => {
        const scale = e.nativeEvent.zoomScale;
        if ((scale > 1.01) !== (zoom.current > 1.01)) props.onZoomChange(scale > 1.01);
        zoom.current = scale;
      }}
      scrollEventThrottle={32}
      onScrollEndDrag={(e) => {
        if (zoom.current <= 1.01 && e.nativeEvent.contentOffset.y < -DISMISS_PULL) props.onPullDown();
      }}
      onTouchEnd={() => {
        // Double-tap toggles between fit and 2.5×, as Photos does.
        const now = Date.now();
        if (now - lastTap.current < 280) {
          const target = zoom.current > 1.01 ? 1 : 2.5;
          const w = props.width / target;
          const h = props.height / target;
          ref.current?.scrollResponderZoomTo?.({
            x: (props.width - w) / 2,
            y: (props.height - h) / 2,
            width: w,
            height: h,
            animated: true,
          });
          lastTap.current = 0;
        } else {
          lastTap.current = now;
        }
      }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${props.label} of card`}
      accessibilityHint="Pinch to zoom. Use the Close button to go back."
    >
      <Image source={{ uri: props.uri }} style={{ width: props.width, height: props.height }} resizeMode="contain" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000' },
  closeButton: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(118,118,128,0.4)',
    zIndex: 1,
  },
  label: { position: 'absolute', alignSelf: 'center', color: '#fff', fontSize: 17, fontWeight: '600', zIndex: 1 },
  dots: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive: { backgroundColor: '#fff' },
});
