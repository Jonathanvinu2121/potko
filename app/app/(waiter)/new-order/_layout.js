import { Stack } from 'expo-router';
import { useTheme } from '../../../src/theme';

// Opening a screen of this section from another tab keeps its first screen underneath, so Back
// and the tab itself always lead somewhere sensible.
export const unstable_settings = { anchor: 'index' };

// The "+ New Order" tab is a small stack: order type → details or tables → menu → preview.
// The bottom bar stays visible on all of them, with this tab highlighted.
export default function NewOrderLayout() {
  const t = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.c.background } }} />;
}
