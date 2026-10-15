import { useLocalSearchParams } from 'expo-router';
import { TransferTable } from '../../../../src/screens/TransferTable';
import { WAITER_PATHS } from '../../../../src/lib/paths';

export default function Transfer() {
  return <TransferTable orderId={Number(useLocalSearchParams().id)} orderPath={WAITER_PATHS.order} />;
}
