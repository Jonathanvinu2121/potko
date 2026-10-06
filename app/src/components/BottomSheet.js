import { useRef } from 'react';
import { KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { Txt } from './Txt';

// A sheet that rises from the bottom over a dim scrim.
// Tapping the scrim or swiping the handle down closes it without doing anything.
//   footer  stays fixed under the scrolling content (the sheet's main button)
export function BottomSheet({ visible, onClose, title, footer, children }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  // The swipe handler is created once, so it reads the latest onClose through a ref.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const swipe = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8,
      onPanResponderRelease: (_, g) => {
        if (g.dy > 50) onCloseRef.current();
      },
    })
  ).current;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          onPress={onClose}
          accessibilityLabel="Close"
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: t.c.scrim }}
        />
        <View
          style={{
            width: '100%',
            maxWidth: 560,
            maxHeight: height * 0.9,
            alignSelf: 'center',
            backgroundColor: t.c.card,
            borderTopLeftRadius: t.radius.sheet,
            borderTopRightRadius: t.radius.sheet,
            paddingBottom: insets.bottom + 16,
          }}
        >
          <View {...swipe.panHandlers} style={{ paddingTop: 10, paddingBottom: 6, paddingHorizontal: t.space.screen, gap: 10 }}>
            <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: t.radius.pill, backgroundColor: t.c.border }} />
            {title ? (
              <Txt size={20} weight={700}>
                {title}
              </Txt>
            ) : null}
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingHorizontal: t.space.screen, paddingBottom: 4, gap: t.d.gap }}
          >
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: t.space.screen, paddingTop: 12 }}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
