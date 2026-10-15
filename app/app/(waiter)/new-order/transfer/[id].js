import { useLocalSearchParams } from 'expo-router';
import { TransferTable } from '../../../../src/screens/TransferTable';
import { TABLES_PATHS } from '../../../../src/lib/paths';

// Move a party to another table, opened from the Tables screen.
export default function Transfer() {
  return <TransferTable orderId={Number(useLocalSearchParams().id)} orderPath={TABLES_PATHS.order} />;
}
