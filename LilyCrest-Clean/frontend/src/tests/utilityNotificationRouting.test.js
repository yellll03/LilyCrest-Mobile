import { resolveNotificationRoute } from '../services/notifications';
import { returnToBilling } from '../utils/navigation';
import { buildNotificationRouteData } from '../utils/notificationPresentation';

jest.mock('../services/api', () => ({ api: { post: jest.fn() } }));

test.each(['water', 'electricity'])('%s notification and feed payload open the same exact bill', utilityType => {
  const billId = '123456789012345678901234';
  const payload = { type:'bill_generated', utilityType, billId, billing_id:billId,
    screen:'billing', url:`/bill-details?billId=${billId}` };
  expect(resolveNotificationRoute(payload)).toBe(`/bill-details?billId=${billId}`);
  expect(resolveNotificationRoute(buildNotificationRouteData({ ...payload,
    notification_id:'event-1', category:'billing', read:false }))).toBe(`/bill-details?billId=${billId}`);
});
test('Back from a notification bill uses history and falls back to Home only without history', () => {
  const router = { canGoBack: () => true, back: jest.fn(), replace:jest.fn() };
  returnToBilling(router);
  expect(router.back).toHaveBeenCalledTimes(1);
  expect(router.replace).not.toHaveBeenCalled();
  const coldRouter = { replace:jest.fn() };
  returnToBilling(coldRouter);
  expect(coldRouter.replace).toHaveBeenCalledWith('/(tabs)/home');
});
