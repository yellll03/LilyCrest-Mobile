import { io } from 'socket.io-client';
import { API_BASE_URL } from '../config/api';
import { getSessionToken } from './secureCredentials';
import { publishCanonicalNotification } from './canonicalEvents';

const listeners = new Map();
let socket = null;
let starting = null;

function emitLocal(event, payload) {
  listeners.get(event)?.forEach((listener) => listener(payload));
}

function registerSocketEvents(instance) {
  ['chat:message-new', 'chat:conversation-updated', 'chat:messages-read'].forEach((event) => {
    instance.on(event, (payload) => emitLocal(event, payload));
  });
  instance.on('notification:new', (payload = {}) => {
    publishCanonicalNotification(payload);
    emitLocal('notification:new', payload);
  });
}

export async function startCanonicalRealtime() {
  if (process.env.NODE_ENV === 'test') return null;
  if (socket) return socket;
  if (starting) return starting;

  starting = (async () => {
    const sessionToken = await getSessionToken();
    if (!sessionToken) return null;

    const instance = io(API_BASE_URL, {
      auth: { sessionToken },
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 4,
      reconnectionDelay: 1500,
      timeout: 10000,
    });
    registerSocketEvents(instance);
    socket = instance;
    return instance;
  })().finally(() => {
    starting = null;
  });

  return starting;
}

export function stopCanonicalRealtime() {
  socket?.disconnect();
  socket = null;
  starting = null;
}

export function subscribeCanonicalRealtime(event, listener) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(listener);
  return () => {
    listeners.get(event)?.delete(listener);
  };
}
