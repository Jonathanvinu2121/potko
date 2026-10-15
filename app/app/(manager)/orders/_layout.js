import { Stack } from 'expo-router';
import { useTheme } from '../../../src/theme';

// Opening a screen of this section from another tab keeps its first screen underneath, so Back
// and the tab itself always lead somewhere sensible.
export const unstable_settings = { anchor: 'index' };

// The manager's Orders section: the list, and one order with its full history.
export default function OrdersLayout() {
  const t = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.c.background } }} />;
}
