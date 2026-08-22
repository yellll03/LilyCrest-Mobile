'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const {
  classifyLegacyLink,
  matchingCanonicalConversations,
} = require('../scripts/auditLegacySupportWorkItems');

const first = {
  _id: new ObjectId('507f1f77bcf86cd799439011'),
  assistantSessionId: 'assistant-session-1',
  tenantUserId: 'tenant-a',
};
const second = {
  _id: new ObjectId('507f1f77bcf86cd799439012'),
  assistantSessionId: 'assistant-session-1',
  tenantUserId: 'tenant-b',
};

test('legacy support matching requires session identity and respects tenant identity', () => {
  assert.deepEqual(
    matchingCanonicalConversations({ session_id: 'assistant-session-1', user_id: 'tenant-a' }, [first, second]),
    [first],
  );
  assert.equal(classifyLegacyLink({ user_id: 'tenant-a' }, [first]).status, 'unlinked');
});

test('only one exact candidate is eligible; ambiguous and conflicting rows remain untouched', () => {
  assert.equal(
    classifyLegacyLink({ session_id: 'assistant-session-1', user_id: 'tenant-a' }, [first, second]).status,
    'eligible',
  );
  assert.equal(
    classifyLegacyLink({ session_id: 'assistant-session-1' }, [first, second]).status,
    'ambiguous',
  );
  assert.equal(
    classifyLegacyLink({
      session_id: 'assistant-session-1',
      user_id: 'tenant-a',
      canonicalConversationId: second._id,
    }, [first, second]).status,
    'conflicting',
  );
  assert.equal(
    classifyLegacyLink({
      session_id: 'assistant-session-1',
      user_id: 'tenant-a',
      canonicalConversationId: first._id,
    }, [first, second]).status,
    'alreadyLinked',
  );
});
