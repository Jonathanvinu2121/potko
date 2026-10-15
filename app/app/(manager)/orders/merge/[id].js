import { useLocalSearchParams } from 'expo-router';
import { MergeTable } from '../../../../src/screens/MergeTable';
import { MANAGER_PATHS } from '../../../../src/lib/paths';

export default function Merge() {
  return <MergeTable tableId={Number(useLocalSearchParams().id)} orderPath={MANAGER_PATHS.order} />;
}
