import { validateFirebaseEnvironment } from '../config/firebaseEnvironment';

describe('Firebase build-environment isolation', () => {
  it('accepts an explicitly marked staging Firebase project', () => {
    expect(validateFirebaseEnvironment({
      environment: 'staging',
      projectId: 'lilycrest-staging-qa',
      storageBucket: 'lilycrest-staging-qa.firebasestorage.app',
      appId: '1:123:android:qa',
    })).toBe(true);
  });

  it.each([
    { projectId: 'lilycrest-production', storageBucket: 'lilycrest-staging-qa.firebasestorage.app' },
    { projectId: 'lilycrest-staging-qa', storageBucket: 'lilycrest.firebasestorage.app' },
  ])('rejects staging builds with a production-looking Firebase resource', (values) => {
    expect(() => validateFirebaseEnvironment({
      environment: 'staging',
      appId: '1:123:android:qa',
      ...values,
    })).toThrow('Firebase environment isolation failed');
  });

  it('rejects a production build containing staging Firebase identifiers', () => {
    expect(() => validateFirebaseEnvironment({
      environment: 'production',
      projectId: 'lilycrest-staging-qa',
      storageBucket: 'lilycrest-staging-qa.firebasestorage.app',
      appId: '1:123:android:qa',
    })).toThrow('production build contains');
  });
});
