import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../src/theme';
import { useAuth } from '../../src/store/auth';
import { roleInfo, homeFor } from '../../src/lib/roles';
import { toast } from '../../src/store/toast';
import { Screen } from '../../src/components/Screen';
import { Txt } from '../../src/components/Txt';
import { Icon } from '../../src/components/Icon';
import { Chip } from '../../src/components/Chip';
import { Button } from '../../src/components/Button';
import { TextField } from '../../src/components/TextField';

const countdown = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

// S2 Login: ID and password for the role picked on the first screen.
export default function Login() {
  const t = useTheme();
  const router = useRouter();
  const role = roleInfo(useLocalSearchParams().role);

  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [otp, setOtp] = useState('');
  const [needOtp, setNeedOtp] = useState(false); // the restaurant asks this role for a one-time code
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false); // the free server is probably waking up
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const shake = useRef(new Animated.Value(0)).current;

  const lockLeft = Math.max(0, Math.ceil((lockedUntil - now) / 1000));

  // Tick once a second while locked so the countdown moves.
  useEffect(() => {
    if (!lockedUntil) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= lockedUntil) setLockedUntil(0);
    }, 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);

  if (!role) return <Redirect href="/role" />;

  const shakeOnce = () => {
    const step = (toValue) => Animated.timing(shake, { toValue, duration: 50, useNativeDriver: Platform.OS !== 'web' });
    Animated.sequence([step(8), step(-8), step(6), step(-6), step(0)]).start();
  };

  const submit = async () => {
    if (busy || lockLeft) return;
    if (needOtp && otp.length < 6) {
      setError('Enter the 6-digit code');
      return shakeOnce();
    }
    if (!loginId.trim() || !password) {
      setError('Enter your ID and password');
      return shakeOnce();
    }
    setError(null);
    setBusy(true);
    const slowTimer = setTimeout(() => setSlow(true), 4000);
    try {
      await useAuth.getState().login({ loginId: loginId.trim(), password, role: role.key, otp: needOtp ? otp : undefined });
      toast(`Signed in as ${useAuth.getState().user.name}`);
      router.replace(homeFor(useAuth.getState().user.role));
    } catch (err) {
      if (err.code === 'otp_required') {
        // Password accepted; this role also needs a code. Keep the password and ask for the code.
        setNeedOtp(true);
        setError(null);
        return;
      }
      if (err.code === 'wrong_otp') {
        setOtp('');
        setError(err.message);
        return shakeOnce();
      }
      if (err.code === 'locked') {
        setNow(Date.now());
        setLockedUntil(Date.now() + (err.data.retryAfter || 60) * 1000);
        setError(null);
      } else {
        setError(err.message);
      }
      if (err.status !== 0) {
        setPassword('');
        shakeOnce();
      }
    } finally {
      clearTimeout(slowTimer);
      setSlow(false);
      setBusy(false);
    }
  };

  const message = lockLeft ? `Too many wrong tries. Try again in ${countdown(lockLeft)}` : error;

  return (
    <Screen narrow>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to role select"
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            marginLeft: -10,
            borderRadius: t.radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? t.c.pressed : 'transparent',
          })}
        >
          <Icon name="arrow-left" />
        </Pressable>
        <Chip label={`${role.label} selected`} icon={role.icon} tone="primary" style={{ alignSelf: 'center' }} />
      </View>

      <Txt size={26} weight={700}>
        Welcome back
      </Txt>
      <Txt color="textSecondary" style={{ marginTop: 4, marginBottom: 16 }}>
        Use your team credentials to continue.
      </Txt>

      <Animated.View style={{ gap: t.d.gap, transform: [{ translateX: shake }] }}>
        <TextField
          label="Staff ID"
          required
          value={loginId}
          onChangeText={setLoginId}
          placeholder="e.g. W-104"
          autoCapitalize="characters"
          error={!!error}
          editable={!busy}
          returnKeyType="next"
        />
        <TextField
          label="Password"
          required
          secure
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          error={!!error}
          editable={!busy}
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        {needOtp ? (
          <View style={{ gap: 6 }}>
            <TextField
              label="One-time code"
              required
              value={otp}
              onChangeText={(v) => setOtp(v.replace(/[^0-9]/g, ''))}
              placeholder="6 digits"
              keyboardType="number-pad"
              maxLength={6}
              error={!!error}
              editable={!busy}
              autoFocus
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            <Txt size={12} color="textSecondary">
              Ask your manager or admin for a code. They make it on their Staff screen; it works once, for 10 minutes.
            </Txt>
          </View>
        ) : null}
      </Animated.View>

      {message ? (
        <View
          accessibilityRole="alert"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginTop: t.d.gap,
            padding: 12,
            borderRadius: t.radius.control,
            backgroundColor: t.c.errorTint,
          }}
        >
          <Icon name={lockLeft ? 'lock-clock' : 'alert-circle-outline'} size={18} color="error" />
          <Txt size={13} weight={600} color="error" tabular style={{ flex: 1 }}>
            {message}
          </Txt>
        </View>
      ) : null}

      <Button title="Sign in" onPress={submit} loading={busy} disabled={!!lockLeft} style={{ marginTop: 16 }} />

      {slow ? (
        <Txt size={13} color="textSecondary" center style={{ marginTop: 12 }}>
          The server is waking up. The first sign-in of the day can take about a minute.
        </Txt>
      ) : null}

      <Button
        title="Need help signing in?"
        variant="link"
        onPress={() => toast('Ask your manager to reset your password', { icon: 'account-question-outline', duration: 4000 })}
        style={{ marginTop: 8 }}
      />
    </Screen>
  );
}
