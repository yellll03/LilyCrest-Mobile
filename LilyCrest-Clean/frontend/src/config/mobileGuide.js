export const MOBILE_GUIDE_VERSION = 1;
export const mobileGuideKey = (userId, version = MOBILE_GUIDE_VERSION) => `@liliora/mobile-guide:v${version}:${userId}`;
export const MOBILE_GUIDE_STEPS = [
  { title: 'Home', route: '/(tabs)/home', body: 'See your current Room and account overview on Home.' },
  { title: 'Billing', route: '/(tabs)/billing', body: 'Check Billing Summary for your current balance and billing details.' },
  { title: 'Maintenance', route: '/(tabs)/services', body: 'Open Services to request Maintenance and follow your request updates.' },
  { title: 'News', route: '/(tabs)/announcements', body: 'Some important announcements may require your acknowledgement. Open the announcement, then tap Acknowledge when you are ready. Opening it only marks it read.' },
  { title: 'Lily Assistant', route: '/(tabs)/chatbot', body: 'Ask Lily Assistant for Lilycrest-specific support and help finding information.' },
  { title: 'Profile, Contract & Extend Stay', route: '/(tabs)/profile', body: 'Use Profile to view your Contract and request an extension, subject to Admin review and contract completion. Track preparation, required contract action, and when your extension becomes effective.' },
];
