import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../src/theme';
import { useDraft } from '../../../src/store/draft';
import { api } from '../../../src/lib/api';
import { Screen } from '../../../src/components/Screen';
import { AppHeader } from '../../../src/components/AppHeader';
import { Txt } from '../../../src/components/Txt';
import { Icon } from '../../../src/components/Icon';
import { Chip } from '../../../src/components/Chip';
import { Button } from '../../../src/components/Button';
import { TextField } from '../../../src/components/TextField';

// W3 Details form.
//   Delivery: customer name is required; phone and address are optional.
//   Takeaway (in-car): car number OR name, at least one.
export default function Details() {
  const t = useTheme();
  const router = useRouter();
  const delivery = useLocalSearchParams().type !== 'takeaway';
  const type = delivery ? 'delivery' : 'takeaway';
  const draft = useDraft();

  // Coming back from the menu shows what was typed before.
  const same = draft.type === type;
  const [name, setName] = useState(same ? draft.customerName : '');
  const [phone, setPhone] = useState(same ? draft.customerPhone : '');
  const [address, setAddress] = useState(same ? draft.deliveryAddress : '');
  const [car, setCar] = useState(same ? draft.carNumber : '');
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    api(`/orders/recent-customers?type=${type}`)
      .then((data) => setRecent(data.customers))
      .catch(() => {}); // the form works without suggestions
  }, [type]);

  const valid = delivery ? name.trim().length > 0 : name.trim().length > 0 || car.trim().length > 0;

  const fill = (c) => {
    setName(c.customer_name || '');
    setPhone(c.customer_phone || '');
    setAddress(c.delivery_address || '');
    setCar(c.car_number || '');
  };

  const next = () => {
    const details = {
      customerName: name.trim(),
      customerPhone: phone.trim(),
      deliveryAddress: delivery ? address.trim() : '',
      carNumber: delivery ? '' : car.trim().toUpperCase(),
    };
    if (same) draft.setDetails(details);
    else draft.start(type, details);
    router.push('/new-order/menu');
  };

  const status = !valid
    ? null
    : delivery
      ? 'Required details complete'
      : car.trim()
        ? 'Car number satisfies the requirement'
        : 'Customer name satisfies the requirement';

  return (
    <Screen
      edges={['top', 'left', 'right']}
      header={<AppHeader title={delivery ? 'Delivery details' : 'Car details'} back />}
      footer={<Button title="Continue to menu" disabled={!valid} onPress={next} />}
    >
      <Txt size={22} weight={700}>
        {delivery ? 'Who is this for?' : 'Which car should we find?'}
      </Txt>
      <Txt color="textSecondary" style={{ marginTop: 4, marginBottom: 16 }}>
        {delivery ? 'Only the customer name is required.' : 'Enter car number or name.'}
      </Txt>

      <View style={{ gap: t.d.gap }}>
        {delivery ? (
          <>
            <TextField label="Customer name" required value={name} onChangeText={setName} placeholder="e.g. Rahul Mehta" autoCapitalize="words" maxLength={80} />
            <TextField label="Phone" value={phone} onChangeText={setPhone} placeholder="Optional" keyboardType="phone-pad" maxLength={20} />
            <TextField label="Delivery address" value={address} onChangeText={setAddress} placeholder="Optional" autoCapitalize="sentences" maxLength={200} />
          </>
        ) : (
          <>
            <TextField label="Car number" value={car} onChangeText={setCar} placeholder="e.g. PB10AB1234" autoCapitalize="characters" maxLength={20} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, height: t.borderWidth, backgroundColor: t.c.border }} />
              <Txt size={12} weight={600} color="textSecondary">
                OR
              </Txt>
              <View style={{ flex: 1, height: t.borderWidth, backgroundColor: t.c.border }} />
            </View>
            <TextField label="Customer name" value={name} onChangeText={setName} placeholder="One of these is required" autoCapitalize="words" maxLength={80} />
          </>
        )}

        {status ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              padding: 12,
              borderRadius: t.radius.control,
              backgroundColor: t.c.successTint,
            }}
          >
            <Icon name="check-circle-outline" size={18} color="successText" />
            <Txt size={13} weight={600} color="successText">
              {status}
            </Txt>
          </View>
        ) : null}

        {recent.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Txt size={12} weight={600} color="textSecondary">
              {delivery ? 'RECENT CUSTOMERS' : 'RECENT CARS'}
            </Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {recent.map((c, index) => (
                <Chip key={index} label={c.car_number || c.customer_name} icon={delivery ? 'account-outline' : 'car-outline'} onPress={() => fill(c)} />
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
