import { useLocalSearchParams } from 'expo-router';
import { BillScreen } from '../../../../src/screens/BillScreen';
import { MANAGER_PATHS } from '../../../../src/lib/paths';

export default function Bill() {
  return <BillScreen orderId={Number(useLocalSearchParams().id)} paths={MANAGER_PATHS} />;
}
