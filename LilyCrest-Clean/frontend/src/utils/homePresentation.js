function hasDisplayValue(value) {
  if (value === null || value === undefined) return false;
  return typeof value !== 'string' || value.trim().length > 0;
}

export function formatHomeCurrency(amount) {
  if (!hasDisplayValue(amount)) return 'Amount unavailable';
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) return 'Amount unavailable';
  return `₱${numericAmount.toLocaleString()}`;
}

export function formatRoomNumber(roomNumber) {
  return hasDisplayValue(roomNumber)
    ? `Room ${String(roomNumber).trim()}`
    : 'Room number unavailable';
}

export function formatRoomType(roomType) {
  return hasDisplayValue(roomType)
    ? String(roomType).trim()
    : 'Room type unavailable';
}

export function formatRoomCapacity(capacity) {
  return hasDisplayValue(capacity)
    ? `${String(capacity).trim()} pax`
    : 'Capacity unavailable';
}

export function formatRoomFloor(floor) {
  return hasDisplayValue(floor)
    ? `Floor ${String(floor).trim()}`
    : 'Floor information unavailable';
}
