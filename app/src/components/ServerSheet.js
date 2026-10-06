import { useEffect, useState } from 'react';
import { useTheme } from '../theme';
import { BUILT_IN, useServer, tidyAddress, checkServer, saveServer } from '../lib/server';
import { toast } from '../store/toast';
import { BottomSheet } from './BottomSheet';
import { TextField } from './TextField';
import { Button } from './Button';
import { Txt } from './Txt';

// Lets the installed app be pointed at the POTKO server (the restaurant's laptop on Wi-Fi, or the
// online address). The address is only saved once a POTKO server has answered there.
export function ServerSheet({ visible, onClose }) {
  const t = useTheme();
  const current = useServer((s) => s.url);
  const [text, setText] = useState(current);
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (visible) {
      setText(current);
      setError(null);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (value) => {
    const url = tidyAddress(value);
    if (!url) return setError('That does not look like an address. Example: 192.168.1.20:4000');
    setError(null);
    setChecking(true);
    const found = await checkServer(url);
    setChecking(false);
    if (!found) {
      return setError('No POTKO server answered there. Check the address, and that this device is on the same Wi-Fi as the server.');
    }
    await saveServer(url);
    toast('Server address saved', { tone: 'success' });
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Server address"
      footer={
        <>
          <Button title="Check and save" loading={checking} disabled={!text.trim()} onPress={() => save(text)} />
          {current !== BUILT_IN ? (
            <Button title="Use the address this app came with" variant="link" disabled={checking} onPress={() => save(BUILT_IN)} style={{ marginTop: 4 }} />
          ) : null}
        </>
      }
    >
      <Txt size={13} color="textSecondary">
        Where this app finds the POTKO server. Change it only when your manager or installer gives you a new address.
      </Txt>
      <TextField
        label="Server address"
        value={text}
        onChangeText={(v) => {
          setText(v);
          setError(null);
        }}
        placeholder="192.168.1.20:4000"
        keyboardType="url"
        error={!!error}
        onSubmitEditing={() => save(text)}
        returnKeyType="done"
      />
      {error ? (
        <Txt size={13} color="error" accessibilityRole="alert">
          {error}
        </Txt>
      ) : null}
      <Txt size={12} color="textSecondary" style={{ marginBottom: t.d.gap }}>
        Using now: {current}
      </Txt>
    </BottomSheet>
  );
}
