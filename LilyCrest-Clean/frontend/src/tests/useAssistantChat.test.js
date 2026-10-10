import { act, renderHook } from '@testing-library/react-native';
import { useAssistantChat } from '../hooks/useAssistantChat';
import { apiService } from '../services/api';

jest.mock('../services/api', () => ({
  apiService: {
    sendChatMessage: jest.fn(),
    resetChatSession: jest.fn(),
  },
}));

describe('useAssistantChat', () => {
  it('blocks overlapping sends even after the cooldown expires', async () => {
    let resolve;
    apiService.sendChatMessage.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { result } = renderHook(() => useAssistantChat('slow-session'));
    let pending;
    act(() => { pending = result.current.sendMessage('hello'); });
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000);
    let blocked;
    await act(async () => { blocked = await result.current.sendMessage('again'); });
    expect(blocked.error.code).toBe('rate_limited');
    expect(apiService.sendChatMessage).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ data: { response: 'done' } }); await pending; });
    now.mockRestore();
    expect(result.current.isTyping).toBe(false);
  });
  beforeEach(() => {
    apiService.sendChatMessage.mockReset();
  });

  it('releases the send guard after failure so the tenant can retry', async () => {
    apiService.sendChatMessage.mockRejectedValueOnce({ response: { status: 400 } });
    const { result } = renderHook(() => useAssistantChat('retry-session'));
    let failed;
    await act(async () => { failed = await result.current.sendMessage('first'); });
    expect(failed.error).toBeDefined();
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000);
    try {
      apiService.sendChatMessage.mockResolvedValueOnce({ data: { response: 'recovered' } });
      let retried;
      await act(async () => { retried = await result.current.sendMessage('first'); });
      expect(retried.response).toBe('recovered');
      expect(result.current.isTyping).toBe(false);
    } finally { now.mockRestore(); }
  });

  it('retries with backoff then succeeds', async () => {
    apiService.sendChatMessage
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce({ data: { response: 'hi', meta: { intent: 'greet', confidence: 0.9 } } });

    const { result } = renderHook(() => useAssistantChat('session-1'));

    let output;
    await act(async () => {
      output = await result.current.sendMessage('hello');
    });

    expect(apiService.sendChatMessage).toHaveBeenCalledTimes(2);
    const firstClientMessageId = apiService.sendChatMessage.mock.calls[0][3];
    const retryClientMessageId = apiService.sendChatMessage.mock.calls[1][3];
    expect(firstClientMessageId).toMatch(/^assistant-message:/);
    expect(retryClientMessageId).toBe(firstClientMessageId);
    expect(output.response).toBe('hi');
    expect(output.metadata.intent).toBe('greet');
  });

  it('unwraps API response envelopes', async () => {
    apiService.sendChatMessage.mockResolvedValue({
      data: {
        success: true,
        data: {
          message: 'hello from Lily',
          intent: 'billing',
          suggestions: [{ label: 'Latest bill', prompt: 'Show my latest bill.' }],
          needs_admin: true,
          meta: { confidence: 1 },
        },
      },
    });

    const { result } = renderHook(() => useAssistantChat('session-1'));

    let output;
    await act(async () => {
      output = await result.current.sendMessage('billing please');
    });

    expect(output.response).toBe('hello from Lily');
    expect(output.intent).toBe('billing');
    expect(output.needsAdmin).toBe(true);
    expect(output.suggestions).toHaveLength(1);
  });

  it('rate limits rapid submits', async () => {
    apiService.sendChatMessage.mockResolvedValue({ data: { response: 'ok' } });
    const { result } = renderHook(() => useAssistantChat('session-2'));

    let first;
    let second;
    await act(async () => {
      first = await result.current.sendMessage('a');
      second = await result.current.sendMessage('b');
    });

    expect(first.error).toBeUndefined();
    expect(second.error.code).toBe('rate_limited');
  });

  it('does not retry an auth failure and returns a safe session message', async () => {
    apiService.sendChatMessage.mockRejectedValueOnce({
      response: { status: 401, data: { detail: 'raw token verifier detail' } },
    });
    const { result } = renderHook(() => useAssistantChat('session-3'));

    let output;
    await act(async () => {
      output = await result.current.sendMessage('hello');
    });

    expect(apiService.sendChatMessage).toHaveBeenCalledTimes(1);
    expect(output.error.detail).toMatch(/session expired/i);
    expect(output.error.detail).not.toContain('raw token verifier detail');
  });

  it('does not expose backend details after retryable server failures', async () => {
    apiService.sendChatMessage.mockRejectedValue({
      response: { status: 500, data: { detail: 'MongoServerError: private internals' } },
    });
    const { result } = renderHook(() => useAssistantChat('session-4'));

    let output;
    await act(async () => {
      output = await result.current.sendMessage('hello');
    });

    expect(apiService.sendChatMessage).toHaveBeenCalledTimes(2);
    expect(output.error.detail).toBe('Chat is temporarily unavailable. Please try again later.');
    expect(output.error.detail).not.toContain('private internals');
  });
});
