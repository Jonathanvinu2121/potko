import { useState } from 'react';
import { ConfirmSheet } from './ConfirmSheet';

// Every on/off switch in a list (categories, dishes, dining areas, tables, a chef's dishes) asks
// first, in the same sheet: what switching it off or on means, then Switch Off / Switch On.
//   const switcher = useSwitchConfirm();
//   switcher.ask({ name, on, text, apply })   on: the state being switched to; apply(): does it
//   {switcher.sheet}                          placed once on the screen
//   switcher.busy                             true while apply() runs
export function useSwitchConfirm() {
  const [asking, setAsking] = useState(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await asking.apply();
    } finally {
      setBusy(false);
      setAsking(null);
    }
  };

  const sheet = (
    <ConfirmSheet
      visible={!!asking}
      title={asking ? `${asking.on ? 'Switch on' : 'Switch off'} ${asking.name}?` : ''}
      text={asking?.text}
      confirmLabel={asking?.on ? 'Switch On' : 'Switch Off'}
      destructive={asking ? !asking.on : false}
      busy={busy}
      onConfirm={confirm}
      onClose={() => setAsking(null)}
    />
  );
  return { ask: setAsking, sheet, busy };
}
