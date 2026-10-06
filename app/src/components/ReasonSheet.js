import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { Txt } from './Txt';
import { Chip } from './Chip';
import { Button } from './Button';
import { TextField } from './TextField';

// Asks for a reason before a request goes to the manager (cancel a cooking dish, a bigger discount).
//   reasons   quick choices shown as chips
//   onSubmit  receives the reason as one line of text; the sheet shows busy until it settles
//   optional  the request may be sent with no reason at all
export function ReasonSheet({ visible, title, text, reasons = [], submitLabel = 'Send to manager', optional, onSubmit, onClose }) {
  const [picked, setPicked] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPicked(null);
    setNote('');
    setBusy(false);
  }, [visible]);

  const reason = [picked, note.trim()].filter(Boolean).join(' — ');

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(reason);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={busy ? () => {} : onClose}
      title={title}
      footer={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Cancel" variant="secondary" disabled={busy} onPress={onClose} style={{ flex: 1 }} />
          <Button title={submitLabel} disabled={!reason && !optional} loading={busy} onPress={submit} style={{ flex: 1.4 }} />
        </View>
      }
    >
      {text ? (
        <Txt size={13} color="textSecondary">
          {text}
        </Txt>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {reasons.map((r) => (
          <Chip key={r} label={r} selected={picked === r} onPress={() => setPicked(picked === r ? null : r)} />
        ))}
      </View>
      <TextField value={note} onChangeText={setNote} placeholder="Add a note (optional)" autoCapitalize="sentences" maxLength={150} editable={!busy} />
    </BottomSheet>
  );
}
