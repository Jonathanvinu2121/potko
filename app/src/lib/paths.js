// Where the shared table and bill screens live for each workspace, and the list a closed table returns to.
// (Two route groups cannot use the same address, so the manager's and the waiter's differ.)
export const MANAGER_PATHS = {
  order: (id) => `/orders/${id}`,
  split: (tableId) => `/orders/split/${tableId}`,
  merge: (tableId) => `/orders/merge/${tableId}`,
  transfer: (orderId) => `/orders/transfer/${orderId}`,
  bill: (orderId) => `/payments/bill/${orderId}`,
  list: '/payments',
};

// The waiter's Tables screen (inside New Order). An order opened from a table stays in this tab.
export const TABLES_PATHS = {
  order: (id) => `/new-order/order/${id}`,
  split: (tableId) => `/new-order/split/${tableId}`,
  merge: (tableId) => `/new-order/merge/${tableId}`,
  transfer: (orderId) => `/new-order/transfer/${orderId}`,
  bill: (orderId) => `/given-orders/bill/${orderId}`,
  list: '/new-order/tables',
};

export const WAITER_PATHS = {
  order: (id) => `/given-orders/${id}`,
  split: (tableId) => `/given-orders/split/${tableId}`,
  merge: (tableId) => `/given-orders/merge/${tableId}`,
  transfer: (orderId) => `/given-orders/transfer/${orderId}`,
  bill: (orderId) => `/given-orders/bill/${orderId}`,
  list: '/given-orders',
};
