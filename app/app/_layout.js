import { useEffect } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from '@expo-google-fonts/inter/useFonts';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_400Regular_Italic } from '@expo-google-fonts/inter/400Regular_Italic';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { useTheme } from '../src/theme';
import { palettes } from '../src/theme/tokens';
import { useAuth } from '../src/store/auth';
import { ToastHost } from '../src/components/Toast';

// Shown by Expo Router if a screen throws while drawing. It uses the plain light palette and no
// app components, so it still works when the thing that broke is one of those.
export function ErrorBoundary({ error, retry }) {
  const c = palettes.light;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: c.background }}>
      <Text style={{ fontSize: 20, fontWeight: '700', color: c.text, textAlign: 'center' }}>Something went wrong on this screen</Text>
      <Text style={{ fontSize: 14, color: c.textSecondary, textAlign: 'center', maxWidth: 420 }}>
        Nothing was lost: orders are saved on the server. Try again, and tell your manager if it keeps happening.
      </Text>
      <Text style={{ fontSize: 12, color: c.textSecondary, textAlign: 'center', maxWidth: 420 }}>{String(error?.message || '')}</Text>
      <Pressable
        onPress={retry}
        accessibilityRole="button"
        style={{ minHeight: 48, minWidth: 180, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primary }}
      >
        <Text style={{ fontSize: 16, fontWeight: '600', color: c.onPrimary }}>Try again</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  const t = useTheme();
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_400Regular_Italic,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const ready = useAuth((s) => s.ready);

  useEffect(() => {
    useAuth.getState().restore();
  }, []);

  // Wait for Inter and for the saved login to be checked, so no screen flashes in the wrong state.
  if ((!fontsLoaded && !fontError) || !ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.c.background }}>
        <ActivityIndicator size="large" color={t.c.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={t.name === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.c.background } }} />
      <ToastHost />
    </SafeAreaProvider>
  );
}
