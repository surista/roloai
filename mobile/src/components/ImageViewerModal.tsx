import React, { useState } from 'react';
import {
  Modal,
  View,
  Image,
  ScrollView,
  Pressable,
  Text,
  StyleSheet,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';

interface Props {
  visible: boolean;
  images: { uri: string; label: string }[];
  initialIndex: number;
  onClose: () => void;
}

export default function ImageViewerModal({ visible, images, initialIndex, onClose }: Props) {
  const { width, height } = useWindowDimensions();
  const [pageIndex, setPageIndex] = useState(initialIndex);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / width);
    setPageIndex(index);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onShow={() => setPageIndex(initialIndex)}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.closeButton} onPress={onClose} hitSlop={12}>
          <Text style={styles.closeButtonText}>Close</Text>
        </Pressable>

        {images.length > 1 && (
          <Text style={styles.label}>{images[pageIndex]?.label}</Text>
        )}

        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: initialIndex * width, y: 0 }}
          onMomentumScrollEnd={handleScroll}
        >
          {images.map((image) => (
            <Pressable key={image.uri} onPress={onClose} style={{ width, height }}>
              <Image source={{ uri: image.uri }} style={styles.image} resizeMode="contain" />
            </Pressable>
          ))}
        </ScrollView>

        {images.length > 1 && (
          <View style={styles.dots}>
            {images.map((image, i) => (
              <View key={image.uri} style={[styles.dot, i === pageIndex && styles.dotActive]} />
            ))}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  image: { width: '100%', height: '100%' },
  closeButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 1,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
  },
  closeButtonText: { color: '#fff', fontWeight: '600' },
  label: {
    position: 'absolute',
    top: 64,
    alignSelf: 'center',
    color: '#fff',
    fontWeight: '600',
    zIndex: 1,
  },
  dots: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive: { backgroundColor: '#fff' },
});
