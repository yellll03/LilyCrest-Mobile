import { api } from './api';

function unwrap(response) {
  return response?.data?.data || response?.data || {};
}

export const chatApi = {
  startConversation: async ({ category, priority } = {}) =>
    unwrap(await api.post('/chat/start', { category, priority })),
  getMyConversations: async () => unwrap(await api.get('/chat/me')),
  getMessages: async (conversationId) =>
    unwrap(await api.get(`/chat/${conversationId}/messages`)),
  sendMessage: async (conversationId, message) =>
    unwrap(await api.post(`/chat/${conversationId}/messages`, { message })),
};
