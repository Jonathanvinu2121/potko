import { Stack } from 'expo-router';
import { useTheme } from '../../../src/theme';

// The "Given Orders" tab: the list, one order's status, and its bill.
export default function GivenOrdersLayout() {
  const t = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.c.background } }} />;
}
