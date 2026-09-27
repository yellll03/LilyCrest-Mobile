/* global test */
import { act, fireEvent, render } from '@testing-library/react-native';
import { View } from 'react-native';
import SupportConcernRating from '../components/assistant/SupportConcernRating';
import InquiryCard from '../components/assistant/InquiryCard';
import { apiService } from '../services/api';
import { matchesSupportNotification, newerSupportConcern } from '../utils/supportConversationPresentation';

jest.mock('../context/ThemeContext', () => ({ useTheme: () => ({ colors: {} }) }));
jest.mock('../services/api', () => ({ apiService: { rateSupportInquiry: jest.fn(), reopenSupportChat: jest.fn(), getSupportChatMessages: jest.fn() } }));
const concern = (overrides = {}) => ({ id: 'thread-a', requestId: 'request-a', tenantUserId: 'tenant-a', status: 'resolved', resolvedAt: '2026-09-28T00:00:00.000Z', resolvedBy: 'admin-a', revision: 2, satisfactionRating: null, ...overrides });
beforeEach(() => jest.resetAllMocks());

test('independent concerns render separate statuses and ratings', () => {
  const view = render(<View>
    <InquiryCard title="Concern A" canonicalStatus="resolved" rating={5} />
    <InquiryCard title="Concern B" canonicalStatus="open" />
    <SupportConcernRating conversation={concern({ satisfactionRating: 5 })} userId="tenant-a" />
    <SupportConcernRating conversation={concern({ id: 'thread-b', requestId: 'request-b', status: 'open' })} userId="tenant-a" />
  </View>);
  expect(view.getByText('Concern A')).toBeTruthy();
  expect(view.getByText('Concern B')).toBeTruthy();
  expect(view.getByText('Open')).toBeTruthy();
  expect(view.getAllByText('Rated 5/5')).toHaveLength(1);
  expect(view.queryByLabelText('Submit rating')).toBeNull();
});

test.each(['open', 'in_review', 'waiting_tenant', 'closed'])('no rating CTA for %s', (status) => {
  const view = render(<SupportConcernRating conversation={concern({ status })} userId="tenant-a" />);
  expect(view.queryByLabelText('Submit rating')).toBeNull();
});

test('wrong owner and legacy thread cannot rate', () => {
  const view = render(<SupportConcernRating conversation={concern()} userId="tenant-b" />);
  expect(view.queryByLabelText('Submit rating')).toBeNull();
  view.rerender(<SupportConcernRating conversation={concern({ requestId: null })} userId="tenant-a" />);
  expect(view.queryByLabelText('Submit rating')).toBeNull();
});

test('submit locks controls, saves exact identity, persists on refresh and ignores older state', async () => {
  let finish;
  apiService.rateSupportInquiry.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const saved = concern({ revision: 3, satisfactionRating: 5, satisfactionFeedback: 'Fixed well' });
  const changed = jest.fn();
  const view = render(<SupportConcernRating conversation={concern()} userId="tenant-a" onChange={changed} />);
  if (view.queryByLabelText("Yes, it's resolved") && !view.queryByLabelText('Submit rating')) fireEvent.press(view.getByLabelText("Yes, it's resolved"));
  fireEvent.press(view.getByLabelText('5 stars'));
  fireEvent.changeText(view.getByLabelText('Rating feedback'), 'Fixed well');
  if (view.queryByLabelText("Yes, it's resolved") && !view.queryByLabelText('Submit rating')) fireEvent.press(view.getByLabelText("Yes, it's resolved"));
  fireEvent.press(view.getByLabelText('Submit rating'));
  if (view.queryByLabelText("Yes, it's resolved") && !view.queryByLabelText('Submit rating')) fireEvent.press(view.getByLabelText("Yes, it's resolved"));
  fireEvent.press(view.getByLabelText('Submit rating'));
  expect(view.getByLabelText('Submit rating')).toBeDisabled();
  expect(apiService.rateSupportInquiry).toHaveBeenCalledTimes(1);
  expect(apiService.rateSupportInquiry).toHaveBeenCalledWith('thread-a', { requestId: 'request-a', revision: 2, rating: 5, feedback: 'Fixed well' });
  await act(async () => finish({ data: { conversation: saved } }));
  expect(view.getByText('Your rating: 5/5')).toBeTruthy();
  expect(view.queryByLabelText('Submit rating')).toBeNull();
  view.rerender(<SupportConcernRating conversation={concern()} userId="tenant-a" />);
  expect(view.getByText('Your rating: 5/5')).toBeTruthy();
  view.unmount();
  const reopened = render(<SupportConcernRating conversation={saved} userId="tenant-a" />);
  expect(reopened.getByText('Your rating: 5/5')).toBeTruthy();
});

test('409 reconciles saved server rating', async () => {
  apiService.rateSupportInquiry.mockRejectedValue({ response: { status: 409 } });
  apiService.getSupportChatMessages.mockResolvedValue({ data: { conversation: concern({ revision: 4, satisfactionRating: 4 }) } });
  const view = render(<SupportConcernRating conversation={concern()} userId="tenant-a" />);
  if (view.queryByLabelText("Yes, it's resolved") && !view.queryByLabelText('Submit rating')) fireEvent.press(view.getByLabelText("Yes, it's resolved"));
  fireEvent.press(view.getByLabelText('5 stars'));
  await act(async () => fireEvent.press(view.getByLabelText('Submit rating')));
  expect(view.getByText('Your rating: 4/5')).toBeTruthy();
  expect(view.queryByLabelText('Submit rating')).toBeNull();
});

test('network failure preserves draft and permits retry', async () => {
  apiService.rateSupportInquiry.mockRejectedValue(new Error('offline'));
  apiService.getSupportChatMessages.mockResolvedValue({ data: { conversation: concern() } });
  const view = render(<SupportConcernRating conversation={concern()} userId="tenant-a" />);
  if (view.queryByLabelText("Yes, it's resolved") && !view.queryByLabelText('Submit rating')) fireEvent.press(view.getByLabelText("Yes, it's resolved"));
  fireEvent.press(view.getByLabelText('3 stars'));
  fireEvent.changeText(view.getByLabelText('Rating feedback'), 'Draft');
  await act(async () => fireEvent.press(view.getByLabelText('Submit rating')));
  expect(view.getByLabelText('Rating feedback').props.value).toBe('Draft');
  expect(view.getByLabelText('Submit rating')).not.toBeDisabled();
});

test('request notification requires both identities and revisions never regress', () => {
  const a = concern(); const b = concern({ id: 'thread-b', requestId: 'request-b' });
  expect([a, b].find((item) => matchesSupportNotification(item, 'thread-b', 'request-b'))).toBe(b);
  expect(matchesSupportNotification(a, 'thread-a', 'request-b')).toBe(false);
  expect(newerSupportConcern(concern({ revision: 8 }), concern({ revision: 7 })).revision).toBe(8);
});

test.each([{ resolvedAt: null }, { resolvedBy: null }, { requestId: '' }])('requires complete admin resolution metadata %j', (fields) => {
  const view = render(<SupportConcernRating conversation={concern(fields)} userId="tenant-a" />);
  expect(view.queryByLabelText('Submit rating')).toBeNull();
});
test('canonical embedded lifecycle overrides stale projections', () => {
  const view = render(<SupportConcernRating conversation={concern({ request: { ...concern(), id: 'request-a', status: 'waiting_tenant', resolvedBy: null } })} userId="tenant-a" />);
  expect(view.queryByLabelText('Submit rating')).toBeNull();
});
test('satisfaction object alone is immutable and legacy saved history stays readable', () => {
  const view = render(<SupportConcernRating conversation={concern({ satisfaction: { rating: 4, feedback: 'Saved' } })} userId="tenant-a" />);
  expect(view.getByText('Your rating: 4/5')).toBeTruthy();
  expect(view.queryByLabelText('Submit rating')).toBeNull();
  view.rerender(<SupportConcernRating conversation={concern({ requestId: null, satisfactionRating: 3, satisfactionFeedback: 'Historical' })} userId="tenant-a" />);
  expect(view.getByText('Historical')).toBeTruthy();
  expect(view.queryByLabelText('Submit rating')).toBeNull();
});
test.each([
  ['REQUEST_REQUIRED',400,'This concern needs to be refreshed before rating.'],
  ['NOT_RESOLVED',409,'You can rate this concern after an admin resolves it.'],
  ['ALREADY_RATED',409,'This support request has already been rated.'],
  ['INVALID_RATING',400,'Choose a whole-number rating from 1 to 5.'],
  ['INVALID_FEEDBACK',400,'Keep your feedback within 1,000 characters.'],
  ['SESSION_EXPIRED',401,'Your session expired. Please sign in again to continue.'],
])('safe rating error %s', async (code,status,message) => {
  apiService.rateSupportInquiry.mockRejectedValue({response:{status,data:{code,error:'Internal secret detail'}}});
  apiService.getSupportChatMessages.mockResolvedValue({data:{conversation:concern()}});
  const view=render(<SupportConcernRating conversation={concern()} userId="tenant-a" />);
  if (view.queryByLabelText("Yes, it's resolved") && !view.queryByLabelText('Submit rating')) fireEvent.press(view.getByLabelText("Yes, it's resolved"));
  fireEvent.press(view.getByLabelText('4 stars'));
  await act(async()=>fireEvent.press(view.getByLabelText('Submit rating')));
  expect(view.getByText(message)).toBeTruthy();
  expect(view.queryByText('Internal secret detail')).toBeNull();
});
test('timeout saved on server reconciles without another submit', async () => {
  apiService.rateSupportInquiry.mockRejectedValue({code:'ECONNABORTED'});
  apiService.getSupportChatMessages.mockResolvedValue({data:{conversation:concern({revision:3,satisfactionRating:4})}});
  const view=render(<SupportConcernRating conversation={concern()} userId="tenant-a" />);
  if (view.queryByLabelText("Yes, it's resolved") && !view.queryByLabelText('Submit rating')) fireEvent.press(view.getByLabelText("Yes, it's resolved"));
  fireEvent.press(view.getByLabelText('4 stars'));
  await act(async()=>fireEvent.press(view.getByLabelText('Submit rating')));
  expect(view.getByText('Your rating: 4/5')).toBeTruthy();
  expect(apiService.rateSupportInquiry).toHaveBeenCalledTimes(1);
  expect(view.queryByLabelText('Submit rating')).toBeNull();
});
test('failed reconciliation locks submission across remount until status check succeeds', async () => {
  const c=concern({id:'uncertain-thread'});
  apiService.rateSupportInquiry.mockRejectedValue({code:'ECONNABORTED'});
  apiService.getSupportChatMessages.mockRejectedValue(new Error('offline'));
  let view=render(<SupportConcernRating conversation={c} userId="tenant-a" />);
  if (view.queryByLabelText("Yes, it's resolved") && !view.queryByLabelText('Submit rating')) fireEvent.press(view.getByLabelText("Yes, it's resolved"));
  fireEvent.press(view.getByLabelText('4 stars'));
  await act(async()=>fireEvent.press(view.getByLabelText('Submit rating')));
  expect(view.getByLabelText('Submit rating')).toBeDisabled();
  view.unmount();
  view=render(<SupportConcernRating conversation={c} userId="tenant-a" />);
  expect(view.getByLabelText("Yes, it's resolved")).toBeDisabled();
  apiService.getSupportChatMessages.mockResolvedValue({data:{conversation:c}});
  await act(async()=>fireEvent.press(view.getByLabelText('Check rating status')));
  if (view.queryByLabelText("Yes, it's resolved") && !view.queryByLabelText('Submit rating')) fireEvent.press(view.getByLabelText("Yes, it's resolved"));
  fireEvent.press(view.getByLabelText('4 stars'));
  expect(view.getByLabelText('Submit rating')).not.toBeDisabled();
  expect(apiService.rateSupportInquiry).toHaveBeenCalledTimes(1);
});
test.each([{id:'other-thread'},{requestId:'other-request'},{tenantUserId:'other-tenant'},null])('mismatched or missing success reconciles %j', async (fields) => {
  apiService.rateSupportInquiry.mockResolvedValue({data:{conversation:fields ? concern({...fields,satisfactionRating:1}) : undefined}});
  apiService.getSupportChatMessages.mockResolvedValue({data:{conversation:concern({revision:3,satisfactionRating:4})}});
  const changed=jest.fn();
  const view=render(<SupportConcernRating conversation={concern()} userId="tenant-a" onChange={changed} />);
  if (view.queryByLabelText("Yes, it's resolved") && !view.queryByLabelText('Submit rating')) fireEvent.press(view.getByLabelText("Yes, it's resolved"));
  fireEvent.press(view.getByLabelText('4 stars'));
  await act(async()=>fireEvent.press(view.getByLabelText('Submit rating')));
  expect(view.getByText('Your rating: 4/5')).toBeTruthy();
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed.mock.calls[0][0].id).toBe('thread-a');
});
test('late response cannot rate a newly selected concern', async () => {
  let finish;
  apiService.rateSupportInquiry.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const changed=jest.fn();
  const view=render(<SupportConcernRating conversation={concern()} userId="tenant-a" onChange={changed} />);
  if (view.queryByLabelText("Yes, it's resolved") && !view.queryByLabelText('Submit rating')) fireEvent.press(view.getByLabelText("Yes, it's resolved"));
  fireEvent.press(view.getByLabelText('4 stars'));
  if (view.queryByLabelText("Yes, it's resolved") && !view.queryByLabelText('Submit rating')) fireEvent.press(view.getByLabelText("Yes, it's resolved"));
  fireEvent.press(view.getByLabelText('Submit rating'));
  view.rerender(<SupportConcernRating conversation={concern({id:'thread-b',requestId:'request-b'})} userId="tenant-a" onChange={changed} />);
  await act(async()=>finish({data:{conversation:concern({revision:3,satisfactionRating:4})}}));
  expect(view.queryByText('Your rating: 4/5')).toBeNull();
  expect(changed).not.toHaveBeenCalled();
});
test('list refresh cannot erase an immutable saved rating at equal revision',()=>{
  expect(newerSupportConcern(concern({satisfactionRating:4}),concern()).satisfactionRating).toBe(4);
});


test('admin resolution prompts Yes or No before exposing rating and repeats after remount', () => {
  let view = render(<SupportConcernRating conversation={concern()} userId="tenant-a" />);
  expect(view.getByText('Is your inquiry resolved?')).toBeTruthy();
  expect(view.queryByLabelText('5 stars')).toBeNull();
  expect(view.queryByLabelText('Submit rating')).toBeNull();
  fireEvent.press(view.getByLabelText("Yes, it's resolved"));
  expect(view.getByText('Rate your support experience')).toBeTruthy();
  expect(apiService.rateSupportInquiry).not.toHaveBeenCalled();
  expect(view.getByLabelText('Submit rating')).toBeDisabled();
  fireEvent.press(view.getByLabelText('1 stars'));
  fireEvent.press(view.getByLabelText('5 stars'));
  expect(view.getByLabelText('5 stars').props.accessibilityState.selected).toBe(true);
  view.unmount();
  view = render(<SupportConcernRating conversation={concern()} userId="tenant-a" />);
  expect(view.getByText('Is your inquiry resolved?')).toBeTruthy();
  expect(view.queryByLabelText('Submit rating')).toBeNull();
});

test('No reopens the same inquiry once without a rating and ignores stale resolved refreshes', async () => {
  let finish;
  apiService.reopenSupportChat.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const changed = jest.fn();
  const view = render(<SupportConcernRating conversation={concern()} userId="tenant-a" onChange={changed} />);
  fireEvent.press(view.getByLabelText('No, I still need help'));
  fireEvent.press(view.getByLabelText('No, I still need help'));
  expect(view.getByLabelText("Yes, it's resolved")).toBeDisabled();
  expect(apiService.reopenSupportChat).toHaveBeenCalledTimes(1);
  expect(apiService.reopenSupportChat).toHaveBeenCalledWith('thread-a', '', { requestId: 'request-a', revision: 2 });
  await act(async () => finish({ data: { conversation: concern({ status: 'open', resolvedAt: null, resolvedBy: null, revision: 3 }) } }));
  expect(view.queryByText('Is your inquiry resolved?')).toBeNull();
  expect(view.queryByLabelText('Submit rating')).toBeNull();
  expect(apiService.rateSupportInquiry).not.toHaveBeenCalled();
  expect(changed.mock.calls[0][0].status).toBe('open');
  view.rerender(<SupportConcernRating conversation={concern()} userId="tenant-a" />);
  expect(view.queryByText('Is your inquiry resolved?')).toBeNull();
});

test('a later admin resolution requires confirmation again', () => {
  const view = render(<SupportConcernRating conversation={concern()} userId="tenant-a" />);
  fireEvent.press(view.getByLabelText("Yes, it's resolved"));
  view.rerender(<SupportConcernRating conversation={concern({ status: 'open', resolvedAt: null, revision: 3 })} userId="tenant-a" />);
  view.rerender(<SupportConcernRating conversation={concern({ resolvedAt: '2026-09-28T01:00:00Z', revision: 4 })} userId="tenant-a" />);
  expect(view.getByText('Is your inquiry resolved?')).toBeTruthy();
  expect(view.queryByLabelText('Submit rating')).toBeNull();
});

test('reopen timeout reconciles saved open state without another mutation', async () => {
  apiService.reopenSupportChat.mockRejectedValue({ code: 'ECONNABORTED' });
  apiService.getSupportChatMessages.mockResolvedValue({ data: { conversation: concern({ status: 'open', revision: 3, resolvedAt: null }) } });
  const view = render(<SupportConcernRating conversation={concern()} userId="tenant-a" />);
  await act(async () => fireEvent.press(view.getByLabelText('No, I still need help')));
  expect(view.queryByLabelText('No, I still need help')).toBeNull();
  expect(apiService.reopenSupportChat).toHaveBeenCalledTimes(1);
  expect(apiService.rateSupportInquiry).not.toHaveBeenCalled();
});
