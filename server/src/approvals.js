// Shared approval query. A request travels with who asked, which order (table, area, guests,
// amounts) and, for a cancel or a void, which dish.
const APPROVAL_SELECT = `
  SELECT a.*, u.name AS requested_by_name, u.role AS requested_by_role, d.name AS decided_by_name,
         o.number AS order_number, o.type AS order_type, o.customer_name, o.car_number, o.guests AS order_guests,
         o.subtotal AS order_subtotal, o.total AS order_total, o.created_at AS order_created_at,
         t.label AS table_label, da.name AS area_name,
         i.name_snapshot AS item_name, i.qty AS item_qty, i.size AS item_size, i.status AS item_status,
         i.qty * i.unit_price AS item_amount
    FROM approvals a
    JOIN users u ON u.id = a.requested_by
    LEFT JOIN users d ON d.id = a.decided_by
    JOIN orders o ON o.id = a.order_id
    LEFT JOIN tables t ON t.id = o.table_id
    LEFT JOIN dining_areas da ON da.id = t.area_id
    LEFT JOIN order_items i ON i.id = a.order_item_id`;

async function getApproval(q, restaurantId, approvalId) {
  const { rows } = await q.query(`${APPROVAL_SELECT} WHERE a.restaurant_id = $1 AND a.id = $2`, [restaurantId, approvalId]);
  return rows[0] || null;
}

module.exports = { APPROVAL_SELECT, getApproval };
