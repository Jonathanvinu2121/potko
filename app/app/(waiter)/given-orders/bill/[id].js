import { useLocalSearchParams } from 'expo-router';
import { BillScreen } from '../../../../src/screens/BillScreen';
import { WAITER_PATHS } from '../../../../src/lib/paths';

// W8 Bill and payment: the same bill screen the counter uses. A waiter who may not take payments
// sends the bill to the manager from here instead.
export default function Bill() {
  return <BillScreen orderId={Number(useLocalSearchParams().id)} paths={WAITER_PATHS} />;
}
