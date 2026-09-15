import { getRoomTransferError } from '../utils/roomTransferErrors';
it.each(['CastError: ObjectId bad', 'E11000 duplicate key', 'Request failed with status code 400', 'undefined', '[object Object]', 'ValidationError: failed', 'action_required', 'Network Error'])('Room Transfer sanitizes %s', message => {
  const output = getRoomTransferError({ message });
  expect(output).not.toContain(message);
  expect(output).toMatch(/refresh|Refresh|connection|try again/i);
});
it('keeps actionable business errors', () => {
  expect(getRoomTransferError({ response: { status: 409, data: { detail: 'That bed is no longer available. Choose another available bed.' } } })).toContain('Choose another');
});
