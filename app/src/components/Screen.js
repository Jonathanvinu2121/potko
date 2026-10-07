import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { useKeepInputVisible } from '../lib/keyboard';

// The frame every screen sits in: safe areas, background, 16px side margins.
//   header  fixed at the top (usually <AppHeader />)
//   footer  sticky action bar at the bottom
//   scroll  set to false for screens that manage their own list
//   narrow  keeps forms at a comfortable width on tablets and desktops
// When the keyboard opens, the content gets shorter instead of being covered: the footer's button
// stays reachable above the keyboard and the field being typed in is scrolled into view.
export function Screen({ header, footer, children, scroll = true, narrow, edges = ['top', 'bottom', 'left', 'right'] }) {
  const t = useTheme();
  const keepVisible = useKeepInputVisible();
  const content = { width: '100%', maxWidth: narrow ? 480 : 1200, alignSelf: 'center', paddingHorizontal: t.space.screen };
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: t.c.background }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        {header}
        {scroll ? (
          <ScrollView
            {...keepVisible}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[content, { flexGrow: 1, paddingTop: 16, paddingBottom: 24 }]}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[content, { flex: 1 }]}>{children}</View>
        )}
        {footer ? (
          <View
            style={{
              backgroundColor: t.c.card,
              borderTopWidth: t.borderWidth,
              borderTopColor: t.c.border,
              paddingVertical: 12,
            }}
          >
            <View style={content}>{footer}</View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
