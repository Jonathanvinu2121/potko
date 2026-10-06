// ₹640, or ₹19.20 when there are paise.
export const money = (amount) => {
  const n = Number(amount) || 0;
  return `₹${Number.isInteger(n) ? n : n.toFixed(2)}`;
};

// "T5" reads as "Table 5"; any other label is shown as it is.
export const tableName = (label = '') => (/^T\d+$/i.test(label) ? `Table ${label.slice(1)}` : label);

// How an order is named everywhere: Table 5 / Delivery – Rahul / Car – PB10AB1234.
// Works for a saved order (snake_case from the server) and for the draft being built.
export function orderLabel(order) {
  const name = order.customer_name ?? order.customerName;
  const car = order.car_number ?? order.carNumber;
  if (order.type === 'dine_in') return tableName(order.table_label ?? order.table?.label);
  if (order.type === 'delivery') return `Delivery – ${name}`;
  return `Car – ${car || name}`;
}
