import { Stack } from 'expo-router';
import { useTheme } from '../../../src/theme';

// The manager's Orders section: the list, and one order with its full history.
export default function OrdersLayout() {
  const t = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.c.background } }} />;
}
