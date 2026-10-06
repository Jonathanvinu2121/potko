import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { BottomSheet } from './BottomSheet';
import { Txt } from './Txt';
import { Icon } from './Icon';
import { Chip } from './Chip';
import { Button } from './Button';
import { TextField } from './TextField';

const REASONS = [
  { key: 'out_of_stock', label: 'Out of stock' },
  { key: 'too_busy', label: 'Kitchen too busy' },
  { key: 'other', label: 'Other' },
];

// The chef's "Deny items" sheet, in two steps.
//   Step 1  "What can't you make?"  tick the dishes. Everything not ticked is accepted.
//   Step 2  "Why?"                  one reason for all ticked dishes, plus an optional note.
// items: the dishes that can still be denied (sent or accepted).
// onSubmit({ itemIds, reason, note }) does the work; the sheet shows it as busy until it settles.
export function DenySheet({ visible, items, onClose, onSubmit }) {
  const t = useTheme();
  const [step, setStep] = useState(1);
  const [ticked, setTicked] = useState([]);
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Start clean every time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setStep(1);
    setTicked([]);
    setReason(null);
    setNote('');
    setBusy(false);
  }, [visible]);

  const all = items.length > 0 && ticked.length === items.length;
  const toggle = (id) => setTicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const share = async () => {
    setBusy(true);
    try {
      await onSubmit({ itemIds: ticked, reason, note: note.trim() });
    } finally {
      setBusy(false);
    }
  };

  const title = step === 2 ? 'Why?' : all ? 'Can’t take this order' : 'What can’t you make?';

  return (
    <BottomSheet
      visible={visible}
      onClose={busy ? () => {} : onClose}
      title={title}
      footer={
        step === 1 ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
            <Button
              title={all ? 'Deny whole order' : `Next (${ticked.length})`}
              disabled={ticked.length === 0}
              onPress={() => setStep(2)}
              style={{ flex: 1 }}
            />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Back" variant="secondary" disabled={busy} onPress={() => setStep(1)} style={{ flex: 1 }} />
            <Button title="Share with waiter" disabled={!reason} loading={busy} onPress={share} style={{ flex: 1.4 }} />
          </View>
        )
      }
    >
      {step === 1 ? (
        <>
          <Txt size={13} color="textSecondary">
            Tick what you can’t make. Everything else is accepted.
          </Txt>
          <View>
            {items.map((item) => {
              const on = ticked.includes(item.id);
              return (
                <Pressable
                  key={item.id}
                  onPress={() => toggle(item.id)}
                  accessibilityRole="checkbox"
                  aria-checked={on}
                  accessibilityLabel={`${item.qty} ${item.name_snapshot}`}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    minHeight: 52,
                    paddingVertical: 6,
                    borderBottomWidth: t.borderWidth,
                    borderBottomColor: t.c.border,
                    backgroundColor: pressed ? t.c.pressed : 'transparent',
                  })}
                >
                  <Icon name={on ? 'checkbox-marked' : 'checkbox-blank-outline'} size={26} color={on ? 'error' : 'textSecondary'} />
                  <Txt size={17} weight={700} color="primary" tabular>
                    {item.qty}×
                  </Txt>
                  <Txt size={16} weight={600} style={{ flex: 1 }}>
                    {item.name_snapshot}
                    {item.size ? ` · ${item.size}` : ''}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : (
        <>
          <Txt size={13} color="textSecondary">
            One reason for {ticked.length === 1 ? 'this item' : `all ${ticked.length} items`}. The waiter sees it straight away.
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {REASONS.map((r) => (
              <Chip key={r.key} label={r.label} selected={reason === r.key} onPress={() => setReason(r.key)} />
            ))}
          </View>
          <TextField
            label="Note for the waiter (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="e.g. back in 20 minutes"
            autoCapitalize="sentences"
            maxLength={200}
            editable={!busy}
          />
        </>
      )}
    </BottomSheet>
  );
}
