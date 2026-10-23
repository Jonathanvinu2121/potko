import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../../src/theme';
import { useAuth, useCan } from '../../../../src/store/auth';
import { useStaff, SENIOR } from '../../../../src/store/staff';
import { api } from '../../../../src/lib/api';
import { toast } from '../../../../src/store/toast';
import { plural } from '../../../../src/lib/format';
import { ROLE_ICON, ROLE_LABEL, ROLE_TEXT } from '../../../../src/lib/roles';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Chip } from '../../../../src/components/Chip';
import { StepChips } from '../../../../src/components/StepChips';
import { Button } from '../../../../src/components/Button';
import { Card } from '../../../../src/components/Card';
import { TextField } from '../../../../src/components/TextField';
import { Check, Box, RadioCard, Line } from '../../../../src/components/Lists';
import { ListState, Notice } from '../../../../src/components/Feedback';
import { Avatar, IconTile, Picture } from '../../../../src/components/Picture';
import { PictureField } from '../../../../src/components/PictureField';
import { Choices, SwitchRow, FormSection } from '../../../../src/components/Forms';

const LOGIN = /^[A-Za-z0-9._@+-]{3,60}$/;
const ROLE_ORDER = ['waiter', 'chef', 'cashier', 'manager', 'admin'];
const LIMITS = [0, 3, 5, 10, 15, 20];

// The tables of an area as tiles that can be ticked.
function TableTiles({ tables, picked, onPress }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {tables.map((table) => {
        const on = picked.includes(table.id);
        return (
          <Pressable
            key={table.id}
            onPress={() => onPress(table)}
            accessibilityRole="checkbox"
            accessibilityLabel={table.label}
            aria-checked={on}
            style={({ pressed }) => ({
              width: 58,
              paddingVertical: 8,
              gap: 4,
              alignItems: 'center',
              borderRadius: t.radius.control,
              borderWidth: on ? 2 : t.borderWidth,
              borderColor: on ? t.c.primary : t.c.border,
              backgroundColor: on ? t.c.primaryTint : pressed ? t.c.pressed : t.c.card,
            })}
          >
            <Box checked={on} />
            <Txt size={13} weight={600} color={on ? 'primary' : 'text'} numberOfLines={1}>
              {table.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

// The ids from the first to the last table of a range, in the area's own order.
function rangeIds(tables, from, to) {
  const a = tables.findIndex((x) => x.id === from);
  const b = tables.findIndex((x) => x.id === to);
  if (a < 0 || b < 0) return [];
  return tables.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.id);
}

// What the server keeps for a waiter: nothing at all means every area and table, now and later.
function accessBody(areas, tables, rules) {
  const on = areas.filter((a) => rules[a.id]?.on);
  if (on.length === areas.length && on.every((a) => rules[a.id].mode === 'all')) return {};
  const out = {};
  for (const area of on) {
    const rule = rules[area.id];
    const mine = tables.filter((x) => x.area_id === area.id);
    if (rule.mode === 'tables') out[area.id] = { mode: 'tables', tables: rule.tables };
    else if (rule.mode === 'range') out[area.id] = { mode: 'tables', tables: rangeIds(mine, rule.from, rule.to), from: rule.from, to: rule.to };
    else out[area.id] = { mode: 'all' };
  }
  return { areas: out };
}

// The form's rules from what is saved for a person (or everything, for a new one).
function rulesFrom(areas, saved) {
  const given = saved?.areas || {};
  const everywhere = Object.keys(given).length === 0;
  return Object.fromEntries(
    areas.map((area) => {
      const rule = given[area.id];
      if (everywhere || !rule) return [area.id, { on: everywhere, mode: 'all', tables: [], from: null, to: null }];
      const ranged = rule.mode === 'tables' && Number.isInteger(rule.from) && Number.isInteger(rule.to);
      return [area.id, { on: true, mode: rule.mode === 'tables' ? (ranged ? 'range' : 'tables') : 'all', tables: rule.tables || [], from: rule.from ?? null, to: rule.to ?? null }];
    })
  );
}

// Dining areas grouped by floor. With one floor there is a single group with no name.
function floorsOf(areas) {
  const groups = [];
  for (const area of areas) {
    let group = groups.find((g) => g.id === area.floor_id);
    if (!group) groups.push((group = { id: area.floor_id, name: area.floor_name, areas: [] }));
    group.areas.push(area);
  }
  return groups.length > 1 ? groups : [{ id: null, name: null, areas }];
}

// The steps each role goes through. The role itself is chosen once, when the person is added;
// "Change role" on the profile opens the role step on its own.
const ROLE_STEPS = {
  waiter: ['areas', 'tables', 'payment', 'prices'],
  chef: ['terminals'],
  cashier: ['prices'],
  manager: ['business'],
  admin: [],
};
const STEP_NAMES = { role: 'Role', basic: 'Details', areas: 'Dining Areas', tables: 'Tables', payment: 'Payment', prices: 'Prices', terminals: 'Terminals', business: 'Access', summary: 'Summary' };
const PAYMENT = {
  take: { title: 'Can Take Payment', text: 'The waiter can generate the bill and take payments directly' },
  close: { title: 'Close Table Only', text: 'The waiter closes the table when the guests are done; a manager or cashier makes the bill and takes the payment. They never see prices or the bill' },
  none: { title: 'No Access', text: 'The waiter cannot close the table or take payments, and never sees prices or the bill' },
};

// More > Staff > Add or Edit, in the steps of the "finals" design, with the step names in a row
// at the top like the dish form (comment 11) and Back / Next at the bottom:
//   waiter   Details > Dining Area Access > Table Access > Payment Permission > Price Visibility > Summary
//   chef     Details > Terminal Access > Summary (the chef sees only these kitchens and their dishes)
//   cashier  Details > Price Visibility > Summary
//   manager  Details > Access (business numbers, approvals) > Summary
// A new person's role is chosen first. ?step= opens one step straight away (from the profile).
export default function StaffForm() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = params.id ? Number(params.id) : null;
  const me = useAuth((s) => s.user);
  const isAdmin = useCan('staff.admin');
  const { areas, tables, terminals, presets, status, error, load } = useStaff();
  const [step, setStep] = useState(0);
  const [jumped, setJumped] = useState(false);
  const [form, setForm] = useState(null);
  const [failed, setFailed] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (changes) => setForm((f) => ({ ...f, ...changes }));
  useEffect(() => {
    load();
  }, [load]);

  // Fill the form once the areas and terminals are known (and the person, when editing).
  useEffect(() => {
    if (status !== 'ready' || form) return;
    if (!id) {
      setForm({ name: '', login_id: '', phone: '', email: '', password: '', image_id: null, role: 'waiter', active: true, rules: rulesFrom(areas, null), payment: 'take', prices: true, terminals: [], limit: 3, reports: true, approvals: true });
      return;
    }
    api(`/users/${id}`)
      .then(({ user }) =>
        setForm({
          name: user.name, login_id: user.login_id, phone: user.phone ?? '', email: user.email ?? '', password: '', image_id: user.image_id, role: user.role, active: user.active,
          rules: rulesFrom(areas, user.role === 'waiter' ? user.access : null),
          payment: user.payment_access ?? (user.can_collect_payment === false ? 'close' : 'take'),
          prices: user.permissions?.['prices.view'] !== false,
          terminals: user.terminals, limit: user.discount_limit_pct ?? 3,
          reports: user.permissions?.['reports.view'] !== false,
          approvals: user.permissions?.['approvals.decide'] !== false,
        })
      )
      .catch((err) => setFailed(err.message));
  }, [status, form, id, areas]);

  const title = id ? 'Edit Staff Member' : 'Add Staff Member';
  if (!form) {
    return (
      <Screen header={<AppHeader title={title} back />}>
        <ListState loading={status !== 'error' && !failed} error={failed ?? (status === 'error' ? error : null)} onRetry={load} rows={5} />
      </Screen>
    );
  }

  const changingRole = !id || params.step === 'role';
  const steps = [...(changingRole ? ['role'] : []), 'basic', ...(ROLE_STEPS[form.role] ?? []), 'summary'];
  // Opened to change one thing only (?step=tables from a profile): start on that step.
  if (params.step && !jumped) {
    setJumped(true);
    const at = steps.indexOf(String(params.step));
    if (at > 0) setStep(at);
  }
  const current = steps[Math.min(step, steps.length - 1)];
  const last = current === 'summary';
  const myself = id && id === me?.id;
  const roles = ROLE_ORDER.filter((role) => isAdmin || !SENIOR.includes(role) || role === form.role);
  const onAreas = areas.filter((a) => form.rules[a.id]?.on);
  const tablesOf = (area) => tables.filter((x) => x.area_id === area.id);
  const setRule = (areaId, changes) => set({ rules: { ...form.rules, [areaId]: { ...form.rules[areaId], ...changes } } });
  const included = (area) => {
    const rule = form.rules[area.id];
    const mine = tablesOf(area);
    return rule.mode === 'all' ? mine : rule.mode === 'tables' ? mine.filter((x) => rule.tables.includes(x.id)) : mine.filter((x) => rangeIds(mine, rule.from, rule.to).includes(x.id));
  };
  const allTables = onAreas.every((a) => form.rules[a.id].mode === 'all');

  // Why this step cannot be left yet, or null when it is complete.
  const problem = {
    role: () => null,
    basic: () =>
      !form.name.trim() ? 'Enter their full name'
        : !LOGIN.test(form.login_id.trim()) ? 'The Staff ID is 3 to 60 letters, digits, dots or dashes. An email address works too.'
          : !id && form.password.length < 6 ? 'The password needs at least 6 characters'
            : id && form.password && form.password.length < 6 ? 'The new password needs at least 6 characters'
              : null,
    areas: () => (areas.length > 0 && onAreas.length === 0 ? 'Choose at least one dining area' : null),
    tables: () => {
      const empty = onAreas.find((a) => form.rules[a.id].mode !== 'all' && included(a).length === 0);
      return empty ? `Choose the tables of ${empty.name}` : null;
    },
    payment: () => null,
    prices: () => null,
    terminals: () => (form.terminals.length === 0 ? 'Choose at least one kitchen terminal' : null),
    business: () => null,
    summary: () => null,
  }[current]();

  const save = async () => {
    setBusy(true);
    try {
      const body = { name: form.name, login_id: form.login_id.trim(), phone: form.phone, email: form.email, image_id: form.image_id, role: form.role };
      if (form.password) body.password = form.password;
      if (form.role === 'waiter') {
        body.access = accessBody(areas, tables, form.rules);
        body.payment_access = form.payment;
      }
      if (form.role === 'chef') body.terminals = form.terminals;
      if (form.role === 'waiter' || form.role === 'cashier') {
        body.discount_limit_pct = form.limit;
        body.permissions = { 'prices.view': form.prices };
      }
      if (form.role === 'manager' && isAdmin) {
        body.permissions = { 'reports.view': form.reports, 'overview.view': form.reports, 'approvals.decide': form.approvals };
      }
      if (id && !myself) body.active = form.active;
      if (myself) delete body.role;
      const { user } = id ? await api(`/users/${id}`, { method: 'PATCH', body }) : await api('/users', { method: 'POST', body });
      toast(id ? `${user.name} saved` : `${user.name} added. Tell them their Staff ID and password.`, { tone: 'success', duration: id ? 2500 : 5000 });
      await load();
      router.back();
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 6000 });
    } finally {
      setBusy(false);
    }
  };

  const heading = {
    role: ['Role', 'Choose what this person does'],
    basic: [title, 'Name, Staff ID and contact'],
    areas: ['Dining Area Access', 'Select which floors this staff can access'],
    tables: ['Table Access', 'Choose how many tables this staff can access'],
    payment: ['Payment Permission', 'Set payment related permission for this waiter'],
    prices: ['Price Visibility', `Set whether this ${ROLE_LABEL[form.role].toLowerCase()} sees item prices`],
    terminals: ['Terminal Access', 'Select the kitchens this chef works at'],
    business: ['Role & Access', 'What this manager may see and approve'],
    summary: ['Permissions Summary', 'Review assigned permissions'],
  }[current];
  const areasText = onAreas.length === areas.length && allTables ? 'All dining areas' : onAreas.map((a) => a.name).join(', ');
  const tablesText = allTables ? 'All tables' : onAreas.flatMap(included).map((x) => x.label).join(', ');

  return (
    <Screen
      narrow
      header={<AppHeader title={heading[0]} subtitle={heading[1]} back onBack={step > 0 ? () => setStep(step - 1) : undefined} />}
      footer={
        <View style={{ gap: 8 }}>
          {problem ? (
            <Txt size={13} color="textSecondary" center>
              {problem}
            </Txt>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title={step === 0 ? 'Cancel' : 'Back'} variant="secondary" disabled={busy} onPress={() => (step === 0 ? router.back() : setStep(step - 1))} style={{ flex: 1 }} />
            <Button title={last ? (id ? 'Save Changes' : 'Add Staff') : 'Next'} disabled={!!problem} loading={busy} onPress={last ? save : () => setStep(step + 1)} style={{ flex: 1.4 }} />
          </View>
        </View>
      }
    >
      <View style={{ gap: 16 }}>
        {/* The steps across the top, as in the dish form. When editing, any step can be opened. */}
        <StepChips steps={steps.map((key) => ({ value: key, label: STEP_NAMES[key] }))} value={current} onChange={(key) => setStep(steps.indexOf(key))} canOpen={(key, n) => !!id || n < step} />

        {current === 'role' ? (
          <FormSection title="Role *" text={myself ? 'You cannot change your own role.' : !isAdmin ? 'Only an admin can add managers and admins.' : 'A person keeps this role; it can be changed later from their profile.'}>
            <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {roles.map((role) => {
                const selected = form.role === role;
                const locked = myself || (SENIOR.includes(role) && !isAdmin);
                return (
                  <Pressable
                    key={role}
                    onPress={() => set({ role })}
                    disabled={locked}
                    accessibilityRole="radio"
                    accessibilityLabel={`${ROLE_LABEL[role]}. ${ROLE_TEXT[role]}`}
                    aria-checked={selected}
                    style={({ pressed }) => ({
                      flexBasis: '47%',
                      flexGrow: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      padding: 12,
                      borderRadius: t.radius.control,
                      borderWidth: selected ? 2 : t.borderWidth,
                      borderColor: selected ? t.c.primary : t.c.border,
                      backgroundColor: selected ? t.c.primaryTint : pressed ? t.c.pressed : t.c.card,
                      opacity: locked && !selected ? 0.5 : 1,
                    })}
                  >
                    <IconTile icon={ROLE_ICON[role]} tone={selected ? 'primary' : 'neutral'} size={40} />
                    <View style={{ flex: 1 }}>
                      <Txt size={15} weight={700}>
                        {ROLE_LABEL[role]}
                      </Txt>
                      <Txt size={12} color="textSecondary">
                        {ROLE_TEXT[role]}
                      </Txt>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </FormSection>
        ) : null}

        {current === 'basic' ? (
          <>
            <PictureField round name={form.name} imageId={form.image_id} onChange={(image_id) => set({ image_id })} label="Add Photo (optional)" hint="JPG or PNG. Shown on the staff list." />
            <TextField label="Full Name" required value={form.name} onChangeText={(name) => set({ name })} placeholder="e.g. Karan Patel" autoCapitalize="words" maxLength={60} />
            <View style={{ gap: 4 }}>
              <TextField label="Staff ID" required value={form.login_id} onChangeText={(login_id) => set({ login_id: login_id.replace(/\s/g, '') })} placeholder="e.g. W-108" autoCapitalize="characters" maxLength={60} />
              <Txt size={12} color="textSecondary">
                They sign in with this Staff ID and the password below. An email address works too.
              </Txt>
            </View>
            <TextField label="Phone (Optional)" value={form.phone} onChangeText={(phone) => set({ phone })} placeholder="+91 98765 43210" keyboardType="phone-pad" maxLength={20} />
            <TextField label={id ? 'New Password' : 'Password'} required={!id} secure value={form.password} onChangeText={(password) => set({ password })} placeholder={id ? 'Leave blank to keep current' : 'At least 6 characters'} maxLength={60} />
            {id && form.password ? <Notice icon="logout" text="Setting a new password signs them out on every device." /> : null}
          </>
        ) : null}

        {current === 'areas' ? (
          <>
            {areas.length === 0 ? <Notice text="No dining areas are set up yet. Add them under More, Tables." /> : null}
            {floorsOf(areas).map((floor) => (
              <View key={floor.id ?? 'all'} style={{ gap: 8 }}>
                {floor.name ? (
                  <Txt size={15} weight={700}>
                    {floor.name}
                  </Txt>
                ) : null}
                {floor.areas.map((area) => (
                  <View key={area.id} style={{ paddingHorizontal: 12, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: form.rules[area.id]?.on ? t.c.primary : t.c.border, backgroundColor: t.c.card }}>
                    <Check
                      label={area.name}
                      sub={plural(area.tables, 'Table')}
                      left={<Picture imageId={area.image_id} icon="floor-plan" size={44} />}
                      checked={!!form.rules[area.id]?.on}
                      onChange={(on) => setRule(area.id, { on })}
                    />
                  </View>
                ))}
              </View>
            ))}
          </>
        ) : null}

        {current === 'tables'
          ? onAreas.map((area) => {
              const rule = form.rules[area.id];
              const mine = tablesOf(area);
              const picked = included(area);
              return (
                <Card key={area.id} style={{ gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <Txt size={16} weight={700}>
                      {area.name}
                    </Txt>
                    <Chip label={rule.mode === 'all' ? `All ${plural(mine.length, 'table')}` : `${plural(picked.length, 'table')} selected`} tone={picked.length ? 'primary' : 'warning'} size={12} />
                  </View>
                  <RadioCard title="All Tables" text="Can access all tables in selected floors" icon="all-inclusive" selected={rule.mode === 'all'} onPress={() => setRule(area.id, { mode: 'all' })} />
                  <RadioCard title="Specific Tables" text="Select individual tables" icon="view-grid-outline" selected={rule.mode === 'tables'} onPress={() => setRule(area.id, { mode: 'tables' })} />
                  <RadioCard title="Table Range" text={`Assign a range of tables (e.g. ${mine[0]?.label ?? 'T1'} – ${mine[Math.min(4, mine.length - 1)]?.label ?? 'T5'})`} icon="format-list-numbered" selected={rule.mode === 'range'} onPress={() => setRule(area.id, { mode: 'range' })} />
                  {rule.mode === 'tables' ? (
                    <>
                      <Txt size={13} weight={600}>
                        Select Tables *
                      </Txt>
                      <TableTiles tables={mine} picked={rule.tables} onPress={(table) => setRule(area.id, { tables: rule.tables.includes(table.id) ? rule.tables.filter((x) => x !== table.id) : [...rule.tables, table.id] })} />
                    </>
                  ) : null}
                  {rule.mode === 'range' ? (
                    <>
                      <Txt size={13} color="textSecondary">
                        {rule.from != null && rule.to == null ? `From ${mine.find((x) => x.id === rule.from)?.label}. Now tap the last table.` : 'Tap the first table of the range, then the last.'}
                      </Txt>
                      <TableTiles tables={mine} picked={picked.map((x) => x.id)} onPress={(table) => setRule(area.id, rule.from == null || rule.to != null ? { from: table.id, to: null } : { to: table.id })} />
                    </>
                  ) : null}
                </Card>
              );
            })
          : null}

        {current === 'payment' ? (
          <>
            {Object.entries(PAYMENT).map(([key, p]) => (
              <RadioCard key={key} title={p.title} text={p.text} selected={form.payment === key} onPress={() => set({ payment: key })} />
            ))}
            <Choices label="Discount they can give without approval" options={[...new Set([...LIMITS, form.limit])].sort((a, b) => a - b).map((n) => ({ value: n, label: n === 0 ? 'None' : `Up to ${n}%` }))} value={form.limit} onChange={(limit) => set({ limit })} />
          </>
        ) : null}

        {current === 'prices' ? (
          form.role === 'waiter' && form.payment !== 'take' ? (
            // A waiter who does not take payment never sees an amount: there is nothing to choose.
            <Notice icon="eye-off-outline" title="Prices stay hidden" text={`${PAYMENT[form.payment].title}: this waiter never sees dish prices or the bill. Choose Can Take Payment in the Payment step to show them.`} />
          ) : (
            <>
              <RadioCard title="Can See Prices" text="Prices show on the menu and on orders" selected={form.prices} onPress={() => set({ prices: true })} />
              <RadioCard title="Cannot See Prices" text="The menu and orders show no dish prices. The bill amount still shows when they take a payment." selected={!form.prices} onPress={() => set({ prices: false })} />
            </>
          )
        ) : null}

        {current === 'terminals' ? (
          <Card style={{ gap: 2 }}>
            {terminals.map((terminal) => (
              <Check
                key={terminal.id}
                label={terminal.name}
                sub="Sees only this kitchen's tickets and dishes"
                checked={form.terminals.includes(terminal.id)}
                onChange={(on) => set({ terminals: on ? [...form.terminals, terminal.id] : form.terminals.filter((x) => x !== terminal.id) })}
              />
            ))}
          </Card>
        ) : null}

        {current === 'business' ? (
          isAdmin ? (
            <>
              <FormSection title="Business Numbers" text="Sales, revenue and reports">
                <RadioCard title="Can See Business Numbers" text="Overview, sales, revenue and every report" selected={form.reports} onPress={() => set({ reports: true })} />
                <RadioCard title="Cannot See Business Numbers" text="Runs the floor, menu and staff without the money figures" selected={!form.reports} onPress={() => set({ reports: false })} />
              </FormSection>
              <FormSection title="Approvals" text="Discounts, cancellations, voids and refunds">
                <RadioCard title="Can Approve with PIN" text="Approves or rejects requests with their own 4-digit PIN" selected={form.approvals} onPress={() => set({ approvals: true })} />
                <RadioCard title="Cannot Approve" text="Requests go to someone else" selected={!form.approvals} onPress={() => set({ approvals: false })} />
              </FormSection>
            </>
          ) : (
            <Notice text="Only an admin can change what a manager may see and approve." />
          )
        ) : null}

        {current === 'summary' ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Avatar name={form.name} imageId={form.image_id} size={56} />
              <View style={{ flex: 1 }}>
                <Txt size={18} weight={700}>
                  {form.name.trim()}
                </Txt>
                <Txt size={13} color="textSecondary">
                  {ROLE_LABEL[form.role]} · {form.login_id.trim()}
                </Txt>
              </View>
            </View>
            <Card style={{ gap: 12 }}>
              {form.role === 'waiter' ? (
                <>
                  <Line label="Dining Areas" value={areasText} muted />
                  <Line label="Tables" value={tablesText} muted />
                  <Line label="Payment Permission" value={PAYMENT[form.payment].title} muted />
                </>
              ) : null}
              {form.role === 'waiter' || form.role === 'cashier' ? <Line label="Prices" value={form.role === 'waiter' && form.payment !== 'take' ? 'Never sees prices or bills' : form.prices ? 'Can see prices' : 'Cannot see prices'} muted /> : null}
              {form.role === 'waiter' || form.role === 'cashier' ? <Line label="Discount without approval" value={form.limit ? `Up to ${form.limit}%` : 'None'} muted /> : null}
              {form.role === 'chef' ? <Line label="Terminals" value={terminals.filter((k) => form.terminals.includes(k.id)).map((k) => k.name).join(', ')} muted /> : null}
              {form.role === 'manager' ? (
                <>
                  <Line label="Business Numbers" value={form.reports ? 'Can see' : 'Cannot see'} muted />
                  <Line label="Approvals" value={form.approvals ? 'Can approve with PIN' : 'Cannot approve'} muted />
                </>
              ) : null}
              <Line label="Password" value={id ? (form.password ? 'New password set' : 'Unchanged') : 'Set'} muted />
            </Card>
            {form.role === 'waiter' && form.payment !== 'take' ? <Txt size={13} color="textSecondary">{PAYMENT[form.payment].text}.</Txt> : null}
            {id && !myself ? <SwitchRow title={form.active ? 'Active' : 'Inactive'} text="An inactive person cannot sign in. Their history is kept." value={form.active} onChange={(active) => set({ active })} /> : null}
            {id ? null : <Notice icon="account-key-outline" text={`${form.name.trim() || 'They'} can sign in as soon as you add them. Tell them their Staff ID and password yourself: nothing is sent by SMS or email.`} />}
          </>
        ) : null}
      </View>
    </Screen>
  );
}
