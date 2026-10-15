import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../../../src/theme';
import { useAuth, useCan } from '../../../../src/store/auth';
import { api } from '../../../../src/lib/api';
import { toast } from '../../../../src/store/toast';
import { METHODS } from '../../../../src/lib/orders';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Button } from '../../../../src/components/Button';
import { Card } from '../../../../src/components/Card';
import { TextField } from '../../../../src/components/TextField';
import { ActionRow, Check } from '../../../../src/components/Lists';
import { Notice } from '../../../../src/components/Feedback';
import { Choices, SwitchRow, FormSection } from '../../../../src/components/Forms';

const TAX_MODES = [
  { value: 'exclusive', label: 'Added on top of prices' },
  { value: 'inclusive', label: 'Already in the prices' },
];
const decimal = (text) => text.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
const inRange = (text, max) => text !== '' && Number.isFinite(Number(text)) && Number(text) >= 0 && Number(text) <= max;

// Settings > POS & Devices: the printers, how payments are taken, and how a bill is worked out.
// Nothing secret is kept here: no payment-provider keys ever belong in the app.
export default function PosDevices() {
  const t = useTheme();
  const router = useRouter();
  const editable = useCan('settings.manage');
  const settings = useAuth((s) => s.restaurant?.settings) ?? {};
  const [form, setForm] = useState({
    kot_printer: settings.devices?.kot_printer ?? '',
    bill_printer: settings.devices?.bill_printer ?? '',
    upi_id: settings.devices?.upi_id ?? '',
    methods: settings.payment_methods ?? ['cash', 'upi', 'card', 'paytm', 'phonepe', 'other'],
    rate: String(settings.tax?.rate ?? 5),
    mode: settings.tax?.mode ?? 'exclusive',
    split: settings.tax?.split !== false,
    service: String(settings.service_charge_pct ?? 0),
    round_off: settings.round_off !== false,
  });
  const [busy, setBusy] = useState(false);
  const set = (changes) => setForm((f) => ({ ...f, ...changes }));
  const problem = form.methods.length === 0 ? 'Keep at least one payment method' : !inRange(form.rate, 100) ? 'The tax rate is between 0 and 100' : !inRange(form.service, 30) ? 'The service charge is between 0 and 30 percent' : null;

  const save = async () => {
    setBusy(true);
    try {
      await api('/restaurant', {
        method: 'PATCH',
        body: {
          devices: { kot_printer: form.kot_printer, bill_printer: form.bill_printer, upi_id: form.upi_id },
          payment_methods: form.methods,
          tax: { rate: Number(form.rate), mode: form.mode, split: form.split },
          service_charge_pct: Number(form.service),
          round_off: form.round_off,
        },
      });
      toast('POS and device settings saved', { tone: 'success' });
      router.back();
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });
    } finally {
      setBusy(false);
    }
  };

  const half = Number(form.rate) / 2;
  return (
    <Screen
      narrow
      header={<AppHeader title="POS & Devices" subtitle="Printers, payments, tax and billing" back />}
      footer={editable ? <Button title={problem ?? 'Save Changes'} disabled={!!problem} loading={busy} onPress={save} /> : null}
    >
      <View style={{ gap: 20 }}>
        {editable ? null : <Notice icon="lock-outline" text="Only an admin can change these. You can see how the restaurant is set up." />}

        <View pointerEvents={editable ? 'auto' : 'none'} style={{ gap: 20 }}>
          <FormSection title="Printers" text="Printing goes through this device's own print dialog, so any printer set up on the phone or tablet works. The names here tell staff which one to pick.">
            <TextField label="Kitchen (KOT) printer" value={form.kot_printer} onChangeText={(kot_printer) => set({ kot_printer })} placeholder="e.g. Kitchen thermal printer" autoCapitalize="sentences" maxLength={80} editable={editable} />
            <TextField label="Bill / receipt printer" value={form.bill_printer} onChangeText={(bill_printer) => set({ bill_printer })} placeholder="e.g. Counter receipt printer" autoCapitalize="sentences" maxLength={80} editable={editable} />
          </FormSection>

          <FormSection title="Payment methods" text="The ways a bill can be paid. Staff confirm each payment themselves; a reference number can be noted.">
            <Card style={{ gap: 0 }}>
              {['cash', 'upi', 'card', 'paytm', 'phonepe', 'other'].map((key) => (
                <Check key={key} label={METHODS[key].label} checked={form.methods.includes(key)} onChange={(on) => set({ methods: on ? [...form.methods, key] : form.methods.filter((m) => m !== key) })} />
              ))}
            </Card>
            <TextField label="UPI ID shown when collecting by UPI (optional)" value={form.upi_id} onChangeText={(upi_id) => set({ upi_id })} placeholder="e.g. restaurant@upi" maxLength={80} editable={editable} />
          </FormSection>

          <FormSection title="Tax and billing" text="Used for new orders from now on. Bills already made keep the tax they were made with. A dish can have its own rate under Menu.">
            <TextField label="GST rate (%)" required value={form.rate} onChangeText={(rate) => set({ rate: decimal(rate) })} keyboardType="decimal-pad" maxLength={5} error={!inRange(form.rate, 100)} editable={editable} />
            <Choices label="Menu prices" options={TAX_MODES} value={form.mode} onChange={(mode) => set({ mode })} columns={1} />
            <SwitchRow title="Show as CGST + SGST" text={inRange(form.rate, 100) ? `The bill shows CGST ${half}% and SGST ${half}% instead of one tax line` : 'The bill shows two equal halves instead of one tax line'} value={form.split} onChange={(split) => set({ split })} />
            <TextField label="Service charge on dine-in bills (%)" value={form.service} onChangeText={(service) => set({ service: decimal(service) })} keyboardType="decimal-pad" maxLength={5} error={!inRange(form.service, 30)} editable={editable} />
            <SwitchRow title="Round the bill to the nearest rupee" text="The difference is shown on the bill as Round off" value={form.round_off} onChange={(round_off) => set({ round_off })} />
            <Notice icon="scale-balance" text="Check your tax rate, GSTIN and what is printed on bills with your accountant before real use." />
          </FormSection>
        </View>

        <FormSection title="Connected devices">
          <View style={{ borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card, paddingVertical: 4 }}>
            <ActionRow icon="cellphone-link" tone="success" title="Signed-in devices" subtitle="Who is signed in, and on which device, is under Staff" onPress={() => router.push('/more/staff')} />
          </View>
        </FormSection>
      </View>
    </Screen>
  );
}
