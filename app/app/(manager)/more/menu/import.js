import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../../src/theme';
import { useMenuAdmin } from '../../../../src/store/menu';
import { api } from '../../../../src/lib/api';
import { pickSpreadsheet, saveServerFile, XLSX_MIME } from '../../../../src/lib/files';
import { toast } from '../../../../src/store/toast';
import { money, plural } from '../../../../src/lib/format';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Icon } from '../../../../src/components/Icon';
import { Card } from '../../../../src/components/Card';
import { Chip } from '../../../../src/components/Chip';
import { Button } from '../../../../src/components/Button';
import { Line, RadioCard } from '../../../../src/components/Lists';
import { Success, Notice } from '../../../../src/components/Feedback';
import { IconTile } from '../../../../src/components/Picture';
import { Choices } from '../../../../src/components/Forms';

const KINDS = {
  categories: {
    title: 'Import Categories',
    one: 'category',
    many: 'categories',
    includes: ['The same menu file as for items (one template for both)', 'Category Name (required) and Category Description (optional)', 'Only the two category columns are read here'],
  },
  items: {
    title: 'Import Items',
    one: 'item',
    many: 'items',
    includes: [
      'Item Name and Category Name (required); a new category is created',
      'Item Code (recommended: updates the dish later, and Go Well With uses it)',
      'Base Price, or Portions written as Regular:220 | Family:390',
      'Open Price, and Tax Mode: Restaurant, Custom (with its rate) or None',
      'Kitchen Terminals (Main Kitchen | Tandoor) and Add-ons (Extra Gravy:30 | …)',
      'Go Well With: the item codes of dishes to suggest',
    ],
  },
};
const STATUS = {
  new: { label: 'New', tone: 'success' },
  update: { label: 'Already on menu', tone: 'warning' },
  error: { label: 'Error', tone: 'error' },
};
const RESULT = { created: 'Created', updated: 'Updated', skipped: 'Skipped', failed: 'Not imported' };

// Import categories or items from a CSV or Excel file:
// template, choose the file, match the columns if the headings differ, preview every row with
// its problems, choose "create new only" or "update matching", import, summary.
// Nothing on the menu is ever overwritten without that choice.
export default function MenuImport() {
  const t = useTheme();
  const router = useRouter();
  const kind = useLocalSearchParams().kind === 'categories' ? 'categories' : 'items';
  const words = KINDS[kind];
  const [step, setStep] = useState('choose'); // choose -> map -> preview -> done
  const [file, setFile] = useState(null); // { name, data }
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [mode, setMode] = useState('create');
  const [filter, setFilter] = useState('all');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(null);

  const fail = (err) => toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 6000 });

  const check = async (picked, chosen) => {
    setBusy('check');
    try {
      const answer = await api('/menu/import/preview', { method: 'POST', body: { kind, filename: picked.name, data: picked.data, mapping: chosen }, timeout: 60000 });
      setPreview(answer);
      if (answer.needs_mapping) {
        setMapping(Object.fromEntries(answer.columns.map((c) => [c.header, c.field])));
        setStep('map');
      } else {
        setMode(answer.counts.update > 0 && answer.counts.new === 0 ? 'update' : 'create');
        setFilter(answer.counts.error > 0 ? 'error' : 'all');
        setStep('preview');
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const choose = async () => {
    try {
      const picked = await pickSpreadsheet();
      if (!picked) return;
      setFile(picked);
      await check(picked, null);
    } catch (err) {
      fail(err);
    }
  };

  const template = (format) => {
    setBusy(`template-${format}`);
    saveServerFile(`/menu/import/template?kind=${kind}&format=${format}`, `POTKO_Menu_Import_Template.${format}`, format === 'csv' ? 'text/csv' : XLSX_MIME)
      .catch(fail)
      .finally(() => setBusy(null));
  };

  const commit = async () => {
    setBusy('import');
    try {
      setResult(await api(`/menu/import/${preview.id}/commit`, { method: 'POST', body: { mode }, timeout: 120000 }));
      useMenuAdmin.getState().load();
      setStep('done');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  // ---------- Summary ----------
  if (step === 'done' && result) {
    const s = result.summary;
    const clean = s.failed === 0 && s.skipped === 0;
    const stat = (label, value, tone) => (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: t.c[`${tone}Tint`] ?? t.c.pressed }}>
          <Txt size={17} weight={700} color={tone === 'success' ? 'successText' : tone === 'warning' ? 'warningText' : tone === 'error' ? 'error' : 'textSecondary'} tabular>
            {value}
          </Txt>
        </View>
        <Txt size={15}>{label}</Txt>
      </View>
    );
    return (
      <Screen
        header={<AppHeader title={clean ? 'Import Success' : 'Import Finished'} back onBack={() => router.back()} />}
        footer={
          <View style={{ gap: 8 }}>
            <Button title="Done" onPress={() => router.back()} />
            {s.failed + s.skipped + s.warnings > 0 ? <Button title="Download Error Report" icon="tray-arrow-down" variant="secondary" loading={busy === 'report'} onPress={() => { setBusy('report'); saveServerFile(`/menu/import/${result.id}/errors.csv`, 'potko-import-report.csv', 'text/csv').catch(fail).finally(() => setBusy(null)); }} /> : null}
          </View>
        }
      >
        <Success title={clean ? 'Import successful' : 'Import finished'} text={`${s.filename} · ${s.mode === 'update' ? 'new rows added, matching rows updated' : 'new rows added, nothing overwritten'}`}>
          <Card style={{ gap: 12 }}>
            {stat('Created', s.created, 'success')}
            {s.mode === 'update' || s.updated > 0 ? stat('Updated', s.updated, 'primary') : null}
            {stat(s.mode === 'update' ? 'Skipped (nothing to change)' : 'Skipped (already on the menu)', s.skipped, 'warning')}
            {stat('Not imported (errors)', s.failed, 'error')}
          </Card>
          {result.problems.length > 0 ? (
            <Card style={{ gap: 10 }}>
              <Txt size={15} weight={700}>
                Rows to look at
              </Txt>
              {result.problems.slice(0, 30).map((p, i) => (
                <View key={i} style={{ gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Txt size={14} weight={600} style={{ flex: 1 }} numberOfLines={1}>
                      Row {p.rows.join(', ')} · {p.name || '(no name)'}
                    </Txt>
                    <Chip label={RESULT[p.result] ?? 'Warning'} tone={p.result === 'failed' ? 'error' : p.result === 'skipped' ? 'warning' : 'neutral'} size={11} />
                  </View>
                  {[...p.errors, ...(p.result_message ? [p.result_message] : []), ...p.warnings].map((m, j) => (
                    <Txt key={j} size={13} color="textSecondary">
                      {m}
                    </Txt>
                  ))}
                </View>
              ))}
              {result.problems.length > 30 ? <Txt size={13} color="textSecondary">And {result.problems.length - 30} more in the error report.</Txt> : null}
            </Card>
          ) : null}
        </Success>
      </Screen>
    );
  }

  // ---------- Match the columns ----------
  if (step === 'map' && preview) {
    const missing = preview.fields.filter((f) => f.required && !Object.values(mapping).includes(f.key));
    return (
      <Screen
        header={<AppHeader title="Match the Columns" subtitle={file?.name} back onBack={() => setStep('choose')} />}
        footer={
          <View style={{ gap: 8 }}>
            {missing.length ? <Txt size={13} color="error" center>Still needed: {missing.map((f) => f.label).join(', ')}</Txt> : null}
            <Button title="Continue" disabled={missing.length > 0} loading={busy === 'check'} onPress={() => check(file, mapping)} />
          </View>
        }
      >
        <View style={{ gap: 14 }}>
          <Notice tone="warning" icon="table-column" title="Some headings were not recognised" text="Tell us what each column of your file holds. Columns you do not need can be left as Not used." />
          {preview.columns.map((column) => (
            <Card key={column.header} style={{ gap: 10 }}>
              <Txt size={15} weight={700}>
                Column “{column.header}”
              </Txt>
              <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                <Chip label="Not used" selected={!mapping[column.header]} onPress={() => setMapping((m) => ({ ...m, [column.header]: null }))} />
                {preview.fields
                  .filter((f) => !Object.entries(mapping).some(([header, field]) => field === f.key && header !== column.header))
                  .map((f) => (
                    <Chip key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} selected={mapping[column.header] === f.key} onPress={() => setMapping((m) => ({ ...m, [column.header]: f.key }))} />
                  ))}
              </ScrollView>
            </Card>
          ))}
        </View>
      </Screen>
    );
  }

  // ---------- Preview ----------
  if (step === 'preview' && preview) {
    const c = preview.counts;
    const rows = preview.records.filter((r) => filter === 'all' || r.status === filter);
    const willCreate = c.new;
    const willUpdate = mode === 'update' ? c.update : 0;
    return (
      <Screen
        header={<AppHeader title="Import Preview" subtitle="Review your data before importing" back onBack={() => setStep('choose')} />}
        footer={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Back" variant="secondary" disabled={!!busy} onPress={() => setStep('choose')} style={{ flex: 1 }} />
            <Button title={`Import (${willCreate + willUpdate})`} disabled={willCreate + willUpdate === 0} loading={busy === 'import'} onPress={commit} style={{ flex: 1.6 }} />
          </View>
        }
      >
        <View style={{ gap: 14 }}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <IconTile icon="file-table-outline" tone="success" />
            <View style={{ flex: 1 }}>
              <Txt size={15} weight={700} numberOfLines={1}>
                {preview.filename}
              </Txt>
              <Txt size={13} color="textSecondary">
                {[c.categories ? plural(c.categories, 'category', 'categories') : null, c.items ? plural(c.items, 'item') : null].filter(Boolean).join(' and ')} found{preview.sheet && preview.sheet !== 'CSV' ? ` on sheet ${preview.sheet}` : ''}
              </Txt>
            </View>
          </Card>

          <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <Chip label={`All ${preview.records.length}`} selected={filter === 'all'} onPress={() => setFilter('all')} />
            <Chip label={`New ${c.new}`} selected={filter === 'new'} onPress={() => setFilter('new')} />
            <Chip label={`Already on menu ${c.update}`} selected={filter === 'update'} onPress={() => setFilter('update')} />
            <Chip label={`Errors ${c.error}`} selected={filter === 'error'} onPress={() => setFilter('error')} />
          </ScrollView>
          {c.error > 0 ? <Notice tone="error" icon="alert-circle-outline" text={`${plural(c.error, 'row')} cannot be imported and will be left out. Fix ${c.error === 1 ? 'it' : 'them'} in the file and import again, or continue with the rest.`} /> : null}
          {(preview.orphans || []).map((line) => (
            <Notice key={line} tone="error" icon="alert-circle-outline" text={line} />
          ))}

          {rows.slice(0, 80).map((r, i) => (
            <View key={`${r.kind}-${r.rows[0]}-${i}`} style={{ gap: 4, padding: 12, borderRadius: t.radius.control, borderWidth: t.borderWidth, borderColor: r.status === 'error' ? t.c.error : t.c.border, backgroundColor: t.c.card }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Txt size={12} color="textSecondary" tabular>
                  Row {r.rows.join(', ')}
                </Txt>
                <Txt size={15} weight={700} style={{ flex: 1 }} numberOfLines={1}>
                  {r.name || '(no name)'}
                </Txt>
                <Chip label={STATUS[r.status].label} tone={STATUS[r.status].tone} size={11} />
              </View>
              <Txt size={13} color="textSecondary" numberOfLines={2}>
                {r.kind === 'category'
                  ? [r.description, r.active === false ? 'Inactive' : null].filter(Boolean).join(' · ') || 'Category'
                  : [
                      r.category,
                      r.code,
                      r.open_price ? 'Open price' : r.portions ? r.portions.map((p) => `${p.label} ${money(p.price)}`).join(', ') : r.price !== undefined && r.price !== null ? money(r.price) : null,
                      r.addons?.length ? plural(r.addons.length, 'add-on') : null,
                      r.kitchens?.length ? r.kitchens.join(' + ') : null,
                      r.go_with?.length ? `Goes well with ${r.go_with.join(', ')}` : null,
                    ].filter(Boolean).join(' · ')}
              </Txt>
              {r.errors.map((m) => (
                <View key={m} style={{ flexDirection: 'row', gap: 6 }}>
                  <Icon name="alert-circle-outline" size={15} color="error" />
                  <Txt size={13} color="error" style={{ flex: 1 }}>
                    {m}
                  </Txt>
                </View>
              ))}
              {r.warnings.map((m) => (
                <View key={m} style={{ flexDirection: 'row', gap: 6 }}>
                  <Icon name="alert-outline" size={15} color="warningText" />
                  <Txt size={13} color="warningText" style={{ flex: 1 }}>
                    {m}
                  </Txt>
                </View>
              ))}
              {r.status === 'update' && r.changes?.length
                ? r.changes.map((ch) => (
                    <Txt key={ch.field} size={13} color="textSecondary">
                      {ch.field}: {ch.old || '—'} → <Txt size={13} weight={700}>{ch.new || '—'}</Txt>
                    </Txt>
                  ))
                : r.status === 'update' ? <Txt size={13} color="textSecondary">Same as on the menu now.</Txt> : null}
            </View>
          ))}
          {rows.length > 80 ? <Txt size={13} color="textSecondary" center>Showing the first 80 of {rows.length} rows.</Txt> : null}

          <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
            <Txt size={15} weight={700}>
              What to do with rows already on the menu
            </Txt>
            <RadioCard title="Create new only" text={`Adds the ${plural(c.new, 'new row')}. The ${plural(c.update, 'row')} already on the menu ${c.update === 1 ? 'is' : 'are'} left exactly as ${c.update === 1 ? 'it is' : 'they are'}.`} selected={mode === 'create'} onPress={() => setMode('create')} />
            <RadioCard title="Update matching records" text={`Adds the ${plural(c.new, 'new row')} and changes the ${plural(c.update, 'matching row')} to what the file says (shown above as old → new). Matching is by item code, or by name within the category.`} selected={mode === 'update'} onPress={() => setMode('update')} disabled={c.update === 0} />
          </View>
        </View>
      </Screen>
    );
  }

  // ---------- Choose a file ----------
  return (
    <Screen header={<AppHeader title={words.title} subtitle={`Add many ${words.many} at once from a file`} back />} footer={<Button title="Choose File" icon="tray-arrow-up" loading={busy === 'check'} onPress={choose} />}>
      <View style={{ gap: 14 }}>
        <Card style={{ alignItems: 'center', gap: 8, paddingVertical: 24, borderStyle: 'dashed' }}>
          <IconTile icon="tray-arrow-up" size={52} />
          <Txt size={16} weight={700}>
            Tap “Choose File” to select your file
          </Txt>
          <Txt size={13} color="textSecondary" center>
            Supports .xlsx and .csv, up to 5 MB and 2,000 rows
          </Txt>
        </Card>

        <View style={{ gap: 10, padding: 14, borderRadius: t.radius.card, backgroundColor: t.c.primaryTint }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <IconTile icon="file-download-outline" size={40} />
            <View style={{ flex: 1 }}>
              <Txt size={15} weight={700}>
                Download Template
              </Txt>
              <Txt size={13} color="textSecondary">
                The menu file: the right headings, sample rows, and a Column Guide sheet
              </Txt>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Excel (.xlsx)" icon="tray-arrow-down" variant="secondary" loading={busy === 'template-xlsx'} onPress={() => template('xlsx')} style={{ flex: 1 }} />
            <Button title="CSV" icon="tray-arrow-down" variant="secondary" loading={busy === 'template-csv'} onPress={() => template('csv')} style={{ flex: 1 }} />
          </View>
        </View>

        <Card style={{ gap: 8 }}>
          <Txt size={15} weight={700}>
            File Format Includes
          </Txt>
          {words.includes.map((line) => (
            <View key={line} style={{ flexDirection: 'row', gap: 8 }}>
              <Icon name="check-circle" size={16} color="success" />
              <Txt size={14} style={{ flex: 1 }}>
                {line}
              </Txt>
            </View>
          ))}
        </Card>
        <Notice text="Every row is checked first and shown to you. Rows with a problem are left out and listed with the reason; nothing already on the menu changes unless you choose to update it." />
        {kind === 'items' ? <Choices label="Importing categories instead?" options={[{ value: 'go', label: 'Open category import', icon: 'shape-outline' }]} value={null} onChange={() => router.replace('/more/menu/import?kind=categories')} /> : null}
      </View>
    </Screen>
  );
}
