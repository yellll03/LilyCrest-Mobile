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
    expect(output.response).toBe('hi');
    expect(output.metadata.intent).toBe('greet');
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
});
