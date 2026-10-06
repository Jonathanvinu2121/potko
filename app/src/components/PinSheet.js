import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { BottomSheet } from './BottomSheet';
import { Txt } from './Txt';
import { Icon } from './Icon';
import { Button } from './Button';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];

// The manager's PIN pad. onSubmit(pin) does the work and may throw: the message is shown here
// and the PIN is cleared so it can be typed again.
export function PinSheet({ visible, title, text, confirmLabel = 'Approve', onSubmit, onClose }) {
  const t = useTheme();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPin('');
    setError(null);
    setBusy(false);
  }, [visible]);

  const press = (key) => {
    setError(null);
    if (key === 'back') setPin((p) => p.slice(0, -1));
    else if (pin.length < 6) setPin((p) => p + key);
  };

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(pin);
    } catch (err) {
      setError(err.message);
      setPin('');
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
          <Button title={confirmLabel} disabled={pin.length < 4} loading={busy} onPress={submit} style={{ flex: 1.4 }} />
        </View>
      }
    >
      {text ? (
        <Txt size={13} color="textSecondary">
          {text}
        </Txt>
      ) : null}

      <View accessibilityLabel={`PIN, ${pin.length} digits entered`} style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, paddingVertical: 4 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <View
            key={i}
            style={{
              width: 14,
              height: 14,
              borderRadius: t.radius.pill,
              borderWidth: 2,
              borderColor: i < pin.length ? t.c.primary : t.c.border,
              backgroundColor: i < pin.length ? t.c.primary : 'transparent',
              opacity: i >= 4 && i >= pin.length ? 0.4 : 1, // digits 5 and 6 are optional
            }}
          />
        ))}
      </View>
      {error ? (
        <Txt size={13} weight={600} color="error" center accessibilityRole="alert">
          {error}
        </Txt>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, alignSelf: 'center', maxWidth: 320 }}>
        {KEYS.map((key, index) =>
          key === '' ? (
            <View key={index} style={{ width: 96, height: 56 }} />
          ) : (
            <Pressable
              key={index}
              onPress={() => press(key)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={key === 'back' ? 'Delete' : key}
              style={({ pressed }) => ({
                width: 96,
                height: 56,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: t.radius.control,
                borderWidth: t.borderWidth,
                borderColor: t.c.border,
                backgroundColor: pressed ? t.c.primaryTint : t.c.background,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              {key === 'back' ? (
                <Icon name="backspace-outline" />
              ) : (
                <Txt size={22} weight={600} tabular>
                  {key}
                </Txt>
              )}
            </Pressable>
          )
        )}
      </View>
    </BottomSheet>
  );
}
