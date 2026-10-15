import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { BottomSheet } from './BottomSheet';
import { Txt } from './Txt';
import { Icon } from './Icon';
import { Button } from './Button';
import { IconTile } from './Picture';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];

// Manager verification: the PIN pad shown before anything sensitive is approved.
// onSubmit(pin) does the work and may throw: the message is shown here (wrong PIN, tries left,
// locked for a while) and the PIN is cleared so it can be typed again. Nothing is approved
// until the server has checked the PIN.
//   onForgot  optional: shows "Forgot PIN?" and is called when it is tapped
export function PinSheet({ visible, title = 'Manager Verification', text = 'Enter your PIN to approve this request', confirmLabel = 'Verify & Approve', onSubmit, onClose, onForgot }) {
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
    else if (pin.length < 4) setPin((p) => p + key);
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
      footer={<Button title={confirmLabel} disabled={pin.length < 4} loading={busy} onPress={submit} />}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconTile icon="shield-check-outline" />
        <View style={{ flex: 1 }}>
          <Txt size={18} weight={700}>
            {title}
          </Txt>
          <Txt size={13} color="textSecondary">
            {text}
          </Txt>
        </View>
        <Pressable onPress={onClose} disabled={busy} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
          <Icon name="close" color="textSecondary" />
        </Pressable>
      </View>

      <Txt size={14} weight={600} center>
        Enter your 4-digit PIN
      </Txt>
      <View accessibilityLabel={`PIN, ${pin.length} of 4 digits entered`} style={{ flexDirection: 'row', justifyContent: 'center', gap: 12 }}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={{
              width: 48,
              height: 56,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: t.radius.control,
              borderWidth: i === pin.length ? 2 : t.borderWidth,
              borderColor: error ? t.c.error : i === pin.length ? t.c.primary : t.c.border,
              backgroundColor: t.c.card,
            }}
          >
            {i < pin.length ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.c.text }} /> : null}
          </View>
        ))}
      </View>
      {error ? (
        <Txt size={13} weight={600} color="error" center accessibilityRole="alert">
          {error}
        </Txt>
      ) : onForgot ? (
        <Pressable onPress={onForgot} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'center' }}>
          <Txt size={13} weight={600} color="primary" style={{ textDecorationLine: 'underline' }}>
            Forgot PIN?
          </Txt>
        </Pressable>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, alignSelf: 'center', maxWidth: 320 }}>
        {KEYS.map((key, index) =>
          key === '' ? (
            <View key={index} style={{ width: 96, height: 52 }} />
          ) : (
            <Pressable
              key={index}
              onPress={() => press(key)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={key === 'back' ? 'Delete' : key}
              style={({ pressed }) => ({
                width: 96,
                height: 52,
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
