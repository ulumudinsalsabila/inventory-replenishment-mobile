import { useEffect, useState } from 'react';
import { Animated, Image, type ImageStyle, Linking, Modal, PanResponder, Pressable, type StyleProp, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ChevronLeft, ChevronRight, ExternalLink, X, ZoomIn, ZoomOut } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_MS = 260;

type Touch = { pageX: number; pageY: number };
const distance = (touches: Touch[]) => Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Thumbnail that opens a full-screen viewer on tap. Pass `images` and `index` to page through a gallery.
 * Children (e.g. a remove button) render above the thumbnail and keep their own presses.
 */
export function PreviewImage({ uri, images, index = 0, style, accessibilityLabel, resizeMode = 'cover', children }: { uri: string; images?: string[]; index?: number; style?: StyleProp<ImageStyle>; accessibilityLabel?: string; resizeMode?: 'cover' | 'contain'; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={accessibilityLabel ? `Perbesar ${accessibilityLabel}` : 'Perbesar foto'} onPress={() => setOpen(true)}>
      <Image source={{ uri }} style={style} resizeMode={resizeMode} />
      {children}
    </Pressable>
    {open ? <ImageViewer images={images?.length ? images : [uri]} initialIndex={images?.length ? index : 0} onClose={() => setOpen(false)} /> : null}
  </>;
}

export function ImageViewer({ images, initialIndex = 0, onClose }: { images: string[]; initialIndex?: number; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(clamp(initialIndex, 0, images.length - 1));
  const [zoomed, setZoomed] = useState(false);
  const go = (delta: number) => setIndex((current) => clamp(current + delta, 0, images.length - 1));
  const [engine] = useState(() => createZoomEngine({ onZoomChange: setZoomed, onSwipe: (direction) => setIndex((current) => clamp(current + direction, 0, images.length - 1)) }));
  useEffect(() => { engine.setViewport(width, height); }, [engine, width, height]);
  useEffect(() => { engine.reset(); }, [engine, index]);
  const uri = images[index];

  return <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}><View style={styles.backdrop}>
    <Animated.View {...engine.panHandlers} style={[StyleSheet.absoluteFill, { transform: [{ translateX: engine.translate.x }, { translateY: engine.translate.y }, { scale: engine.scale }] }]}>
      <Image source={{ uri }} style={styles.full} resizeMode="contain" />
    </Animated.View>
    <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
      <Text style={styles.counter}>{images.length > 1 ? `${index + 1} / ${images.length}` : ''}</Text>
      <View style={styles.actions}>
        <IconButton label={zoomed ? 'Perkecil' : 'Perbesar'} onPress={engine.toggle}>{zoomed ? <ZoomOut size={20} color="#fff" /> : <ZoomIn size={20} color="#fff" />}</IconButton>
        {/^https?:/.test(uri) ? <IconButton label="Buka gambar asli" onPress={() => void Linking.openURL(uri)}><ExternalLink size={19} color="#fff" /></IconButton> : null}
        <IconButton label="Tutup" onPress={onClose}><X size={21} color="#fff" /></IconButton>
      </View>
    </View>
    {images.length > 1 && !zoomed ? <>
      {index > 0 ? <IconButton label="Foto sebelumnya" onPress={() => go(-1)} style={[styles.nav, styles.navLeft]}><ChevronLeft size={24} color="#fff" /></IconButton> : null}
      {index < images.length - 1 ? <IconButton label="Foto berikutnya" onPress={() => go(1)} style={[styles.nav, styles.navRight]}><ChevronRight size={24} color="#fff" /></IconButton> : null}
    </> : null}
    <Text style={[styles.hint, { bottom: insets.bottom + 16 }]}>Cubit atau ketuk dua kali untuk memperbesar</Text>
  </View></Modal>;
}

/**
 * Gesture state lives outside React render: pinch to zoom, drag to pan while zoomed,
 * double tap to toggle, swipe sideways at 1x to page.
 */
function createZoomEngine({ onZoomChange, onSwipe }: { onZoomChange: (zoomed: boolean) => void; onSwipe: (direction: number) => void }) {
  const scale = new Animated.Value(1);
  const translate = new Animated.ValueXY();
  const s = { width: 0, height: 0, scale: 1, x: 0, y: 0, pinchStart: 0, scaleStart: 1, lastTap: 0, moved: false };
  const bounds = (nextScale: number) => ({ x: (s.width * (nextScale - 1)) / 2, y: (s.height * (nextScale - 1)) / 2 });
  const apply = (nextScale: number, x: number, y: number, animated: boolean) => {
    const limit = bounds(nextScale);
    s.scale = nextScale; s.x = clamp(x, -limit.x, limit.x); s.y = clamp(y, -limit.y, limit.y);
    onZoomChange(nextScale > 1.01);
    if (animated) Animated.parallel([Animated.spring(scale, { toValue: s.scale, useNativeDriver: true }), Animated.spring(translate, { toValue: { x: s.x, y: s.y }, useNativeDriver: true })]).start();
    else { scale.setValue(s.scale); translate.setValue({ x: s.x, y: s.y }); }
  };
  const toggle = () => apply(s.scale > 1.01 ? 1 : 2.5, 0, 0, true);
  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (event) => {
      s.moved = false; s.scaleStart = s.scale;
      s.pinchStart = event.nativeEvent.touches.length === 2 ? distance(event.nativeEvent.touches) : 0;
    },
    onPanResponderMove: (event, gesture) => {
      const touches = event.nativeEvent.touches;
      if (Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6) s.moved = true;
      if (touches.length === 2) {
        if (!s.pinchStart) { s.pinchStart = distance(touches); s.scaleStart = s.scale; return; }
        apply(clamp(s.scaleStart * (distance(touches) / s.pinchStart), MIN_SCALE, MAX_SCALE), s.x, s.y, false);
      } else if (s.scale > 1.01 && !s.pinchStart) {
        const limit = bounds(s.scale);
        translate.setValue({ x: clamp(s.x + gesture.dx, -limit.x, limit.x), y: clamp(s.y + gesture.dy, -limit.y, limit.y) });
      }
    },
    onPanResponderRelease: (_, gesture) => {
      if (s.pinchStart) { s.pinchStart = 0; if (s.scale < 1.05) apply(1, 0, 0, true); return; }
      if (s.scale > 1.01) apply(s.scale, s.x + gesture.dx, s.y + gesture.dy, false);
      else if (Math.abs(gesture.dx) > 60 && Math.abs(gesture.dx) > Math.abs(gesture.dy)) { onSwipe(gesture.dx < 0 ? 1 : -1); return; }
      if (!s.moved) {
        const now = Date.now();
        if (now - s.lastTap < DOUBLE_TAP_MS) { s.lastTap = 0; toggle(); } else s.lastTap = now;
      }
    },
  });
  return {
    scale, translate, toggle, panHandlers: responder.panHandlers,
    setViewport: (width: number, height: number) => { s.width = width; s.height = height; },
    reset: () => apply(1, 0, 0, false),
  };
}

function IconButton({ label, onPress, style, children }: { label: string; onPress: () => void; style?: object; children: React.ReactNode }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={8} onPress={onPress} style={[styles.iconButton, style]}>{children}</Pressable>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#05090fee' }, full: { width: '100%', height: '100%' },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  counter: { color: '#fff', fontSize: 13, fontWeight: '800' }, actions: { flexDirection: 'row', gap: 8 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#ffffff26' },
  nav: { position: 'absolute', top: '50%', marginTop: -20 }, navLeft: { left: 12 }, navRight: { right: 12 },
  hint: { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: '#ffffffa6', fontSize: 11 },
});
