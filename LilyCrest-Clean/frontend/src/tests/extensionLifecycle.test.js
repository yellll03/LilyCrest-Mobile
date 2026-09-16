/* global test */
import { extensionPresentation, extensionError } from '../utils/extendStayPresentation';
import { confirmAcknowledgement, acknowledgementError } from '../utils/announcementEngagement';
test.each([
 ['pending', null, 'Pending Admin Review'], ['approved', 'preparing', 'Approved — Preparing Your Contract'],
 ['approved', 'awaiting_contract', 'Approved — Contract Action Required'], ['approved', 'awaiting_effective_date', 'Approved — Starts on January 1, 2027'],
 ['approved', 'effective', 'Extension Effective'], ['approved', 'action_required', 'Approved — Administration Is Resolving an Issue'], ['rejected', null, 'Extension Request Declined'],
])('presents %s %s', (status, fulfillmentState, label) => {
 const result = extensionPresentation({ status, fulfillmentState, currentEndDate: '2026-12-31T00:00:00+08:00', preparationFailure: { code: 'SECRET' } });
 expect(result.label).toBe(label); expect(result.nextAction).not.toContain('SECRET');
});
test.each([
 ['A renewal already exists.', 'already being processed'], ['An extension request is already pending.', 'already being processed'],
 ['Resolve the room transfer request first.', 'Room Transfer in progress'], ['Move-out clearance has already started.', 'Move Out process'],
 ['A current active stay is required.', 'eligible stay'], ['Only active tenants may extend a stay.', 'eligible stay'],
 ['Your current lease must not have ended.', 'eligible stay'], ['A current contract is required.', 'contract must be available'],
 ['Choose an extension of 1 to 24 whole months.', 'valid extension duration'], ['E11000 secret', "couldn't process"],
])('maps %s safely', (detail, expected) => expect(extensionError({ response: { data: { detail } } })).toContain(expected));
test('offline mapping', () => expect(extensionError(new Error('socket secret'))).toContain("You're offline"));
test('lost acknowledgement response reconciles successful write', async () => {
 const api = { getAnnouncement: jest.fn().mockResolvedValueOnce({ data: { requiresAcknowledgment: true } }).mockResolvedValueOnce({ data: { acknowledged: true } }), acknowledgeAnnouncement: jest.fn().mockRejectedValue(new Error('timeout')) };
 expect(await confirmAcknowledgement(api, 'a')).toEqual({ acknowledged: true }); expect(api.acknowledgeAnnouncement).toHaveBeenCalledTimes(1);
});
test.each([{ acknowledged: true }, { requiresAcknowledgment: false }])('avoids redundant write %j', async (data) => {
 const api = { getAnnouncement: jest.fn().mockResolvedValue({ data }), acknowledgeAnnouncement: jest.fn() };
 expect(await confirmAcknowledgement(api, 'a')).toEqual(data); expect(api.acknowledgeAnnouncement).not.toHaveBeenCalled();
});
test.each([[404, 'no longer available'], [400, 'No acknowledgement'], [503, 'temporarily unavailable'], [null, 'Check your connection']])('friendly acknowledgement error %s', (status, text) => expect(acknowledgementError(status ? { response: { status } } : {})).toContain(text));

test('closing the acknowledgement flow during its read prevents a later write', async () => {
 let current = true;
 const api = { getAnnouncement: jest.fn(async () => { current = false; return { data: { requiresAcknowledgment: true } }; }), acknowledgeAnnouncement: jest.fn(async () => ({ data: { acknowledged: true } })) };
 await expect(confirmAcknowledgement(api, 'a', { isCurrent: () => current })).rejects.toMatchObject({ code: 'ENGAGEMENT_CANCELLED' });
 expect(api.acknowledgeAnnouncement).not.toHaveBeenCalled();
});
