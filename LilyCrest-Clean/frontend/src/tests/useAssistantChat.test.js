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
  beforeEach(() => {
    apiService.sendChatMessage.mockReset();
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
