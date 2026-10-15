// A waiter's assigned areas and tables, read the same way the server reads them.
// The server refuses a table that is not assigned; this only keeps such tables off the waiter's screen.
//   {}                                                     every area and table
//   { areas: { "3": { mode: "all" } } }                    all of area 3, nothing else
//   { areas: { "3": { mode: "tables", tables: [9, 10] } } }
// A split part (T4.1) follows its parent table (T4).
export function tableAllowed(access, table) {
  const areas = access?.areas;
  if (!areas || Object.keys(areas).length === 0) return true;
  const rule = areas[String(table.area_id)];
  if (!rule) return false;
  if (rule.mode !== 'tables') return true;
  const ids = Array.isArray(rule.tables) ? rule.tables : [];
  return ids.includes(table.id) || (table.parent_table_id != null && ids.includes(table.parent_table_id));
}

export const areaAllowed = (access, areaId) => {
  const areas = access?.areas;
  return !areas || Object.keys(areas).length === 0 || !!areas[String(areaId)];
};
