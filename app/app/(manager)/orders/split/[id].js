import { useLocalSearchParams } from 'expo-router';
import { SplitTable } from '../../../../src/screens/SplitTable';
import { MANAGER_PATHS } from '../../../../src/lib/paths';

export default function Split() {
  return <SplitTable tableId={Number(useLocalSearchParams().id)} orderPath={MANAGER_PATHS.order} />;
}
