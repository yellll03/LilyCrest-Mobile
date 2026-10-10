/* global test */
jest.mock('../services/secureCredentials', () => ({ getSessionCredentials: jest.fn().mockResolvedValue(null) }));
jest.mock('../services/sessionEvents', () => ({ emitSessionExpired: jest.fn(), emitSessionRecovered: jest.fn() }));
const { api, apiService } = require('../services/api');

test('support rating helper sends the canonical fields through the real Axios transform', async () => {
  const calls = [];
  const previous = api.defaults.adapter;
  api.defaults.adapter = async (config) => {
    calls.push(config);
    return { status: 200, statusText: 'OK', headers: {}, config, data: { conversation: { id: 'thread-a' } } };
  };
  try {
    await apiService.confirmSupportResolution('thread-a', true, '', { requestId: 'request-a', rating: 4, feedback: ' Fixed ' });
    expect(calls[0].method).toBe('patch');
    expect(calls[0].url).toBe('/chat/thread-a/resolution');
    expect(JSON.parse(calls[0].data)).toEqual({ resolved: true, note: '', requestId: 'request-a', rating: 4, feedback: 'Fixed' });
  } finally { api.defaults.adapter = previous; }
});

test('legacy helper retains its existing body without invented identity', async () => {
  const patch = jest.spyOn(api, 'patch').mockResolvedValue({ data: {} });
  try {
    await apiService.confirmSupportResolution('legacy-thread', false, 'Not resolved');
    expect(patch).toHaveBeenCalledWith('/chat/legacy-thread/resolution', { resolved: false, note: 'Not resolved' });
  } finally { patch.mockRestore(); }
});
