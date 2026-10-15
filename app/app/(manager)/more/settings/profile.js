import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth, useCan } from '../../../../src/store/auth';
import { api } from '../../../../src/lib/api';
import { toast } from '../../../../src/store/toast';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Button } from '../../../../src/components/Button';
import { TextField } from '../../../../src/components/TextField';
import { Notice } from '../../../../src/components/Feedback';
import { PictureField } from '../../../../src/components/PictureField';

// Settings > Restaurant Profile: what guests see at the top of a bill, and the name in every header.
export default function RestaurantProfile() {
  const router = useRouter();
  const restaurant = useAuth((s) => s.restaurant);
  const editable = useCan('settings.manage');
  const profile = restaurant?.profile ?? {};
  const [form, setForm] = useState({
    name: restaurant?.name ?? '',
    logo_image_id: profile.logo_image_id ?? null,
    email: profile.email ?? '',
    phone: profile.phone ?? '',
    address: profile.address ?? '',
    gstin: profile.gstin ?? '',
    footer: profile.footer ?? '',
  });
  const [busy, setBusy] = useState(false);
  const set = (changes) => setForm((f) => ({ ...f, ...changes }));

  const save = async () => {
    setBusy(true);
    try {
      const { name, ...rest } = form;
      await api('/restaurant', { method: 'PATCH', body: { name, profile: rest } });
      toast('Restaurant profile saved', { tone: 'success' });
      router.back();
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      narrow
      header={<AppHeader title="Restaurant Profile" subtitle="Name, logo, address and contact" back />}
      footer={editable ? <Button title="Save Changes" disabled={!form.name.trim()} loading={busy} onPress={save} /> : null}
    >
      <View style={{ gap: 16 }} pointerEvents={editable ? 'auto' : 'none'}>
        {editable ? null : <Notice icon="lock-outline" text="Only an admin can change the restaurant profile." />}
        <PictureField imageId={form.logo_image_id} onChange={(logo_image_id) => set({ logo_image_id })} icon="storefront-outline" label="Restaurant Logo (optional)" hint="Square PNG or JPG. Printed at the top of the bill." size={84} />
        <TextField label="Restaurant Name" required value={form.name} onChangeText={(name) => set({ name })} autoCapitalize="words" maxLength={60} editable={editable} />
        <TextField label="Email" value={form.email} onChangeText={(email) => set({ email })} placeholder="hello@restaurant.com" keyboardType="email-address" maxLength={80} editable={editable} />
        <TextField label="Phone" value={form.phone} onChangeText={(phone) => set({ phone })} placeholder="+91 98765 43210" keyboardType="phone-pad" maxLength={20} editable={editable} />
        <TextField label="Address" value={form.address} onChangeText={(address) => set({ address })} placeholder="Street, area, city and PIN code" autoCapitalize="sentences" multiline maxLength={200} editable={editable} />
        <TextField label="GSTIN (printed on the bill)" value={form.gstin} onChangeText={(gstin) => set({ gstin: gstin.toUpperCase() })} placeholder="15 characters" autoCapitalize="characters" maxLength={20} editable={editable} />
        <TextField label="Line at the bottom of the bill" value={form.footer} onChangeText={(footer) => set({ footer })} placeholder="Thank you. Visit again!" autoCapitalize="sentences" maxLength={120} editable={editable} />
        <Notice text="The name shows in every screen's header, and the name, logo, address, phone and GSTIN are printed on bills. Check tax details on the bill with your accountant." />
      </View>
    </Screen>
  );
}
