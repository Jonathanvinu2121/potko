import { useLocalSearchParams } from 'expo-router';
import { TransferTable } from '../../../../src/screens/TransferTable';
import { MANAGER_PATHS } from '../../../../src/lib/paths';

export default function Transfer() {
  return <TransferTable orderId={Number(useLocalSearchParams().id)} orderPath={MANAGER_PATHS.order} />;
}
