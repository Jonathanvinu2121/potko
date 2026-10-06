import { View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { Txt } from './Txt';
import { Button } from './Button';

// Asks "are you sure?" before something that cannot be undone (remove a sent dish, close a table).
// Routine actions never use this: they just happen and say so in a toast.
export function ConfirmSheet({ visible, title, text, confirmLabel, destructive, busy, onConfirm, onClose }) {
  return (
    <BottomSheet
      visible={visible}
      onClose={busy ? () => {} : onClose}
      title={title}
      footer={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Cancel" variant="secondary" disabled={busy} onPress={onClose} style={{ flex: 1 }} />
          <Button title={confirmLabel} variant={destructive ? 'destructive' : 'primary'} loading={busy} onPress={onConfirm} style={{ flex: 1.4 }} />
        </View>
      }
    >
      {text ? <Txt color="textSecondary">{text}</Txt> : null}
    </BottomSheet>
  );
}
