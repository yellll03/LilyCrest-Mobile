/**
 * LilyCrest Mobile App — System Process Flow Document PDF Generator
 * Covers every tenant-facing feature from app launch to sign-out, step by step.
 * Run:    node backend/scripts/generateSystemFlowPdf.js
 * Output: backend/scripts/LilyCrest_System_Process_Flow.pdf
 */

const fs   = require('fs');
const path = require('path');

// ── Brand Colors ─────────────────────────────────────────────────────────────
const NAVY   = { r: 0.078, g: 0.212, b: 0.353 };
const ORANGE = { r: 0.831, g: 0.408, b: 0.165 };
const GREEN  = { r: 0.133, g: 0.545, b: 0.133 };
const TEAL   = { r: 0.000, g: 0.502, b: 0.502 };
const AMBER  = { r: 0.800, g: 0.600, b: 0.000 };
const RED    = { r: 0.753, g: 0.114, b: 0.114 };
const BLUE   = { r: 0.094, g: 0.443, b: 0.824 };
const PURPLE = { r: 0.502, g: 0.251, b: 0.502 };
const LIGHT  = { r: 0.961, g: 0.969, b: 0.980 };
const VLIGHT = { r: 0.945, g: 0.945, b: 0.945 };
const WHITE  = { r: 1.000, g: 1.000, b: 1.000 };
const DGRAY  = { r: 0.200, g: 0.200, b: 0.200 };
const MGRAY  = { r: 0.450, g: 0.450, b: 0.450 };
const LGRAY  = { r: 0.878, g: 0.878, b: 0.878 };

// ── Step Type Styles ─────────────────────────────────────────────────────────
const STEP_TYPES = {
  user:    { color: BLUE,   label: 'TENANT'  },
  system:  { color: TEAL,   label: 'SYSTEM'  },
  api:     { color: ORANGE, label: 'API CALL' },
  branch:  { color: AMBER,  label: 'BRANCH'  },
  success: { color: GREEN,  label: 'SUCCESS' },
  error:   { color: RED,    label: 'ERROR'   },
  note:    { color: PURPLE, label: 'NOTE'    },
};

const STEP_TYPE_DESC = {
  user:    'Action performed by the tenant',
  system:  'App-side processing or state change',
  api:     'Network request to the backend API',
  branch:  'Conditional logic or decision point',
  success: 'Positive outcome or confirmation',
  error:   'Failure path or error handling',
  note:    'Prerequisite or important context',
};

// ── Page Layout ───────────────────────────────────────────────────────────────
const PAGE_W   = 612;
const PAGE_H   = 792;
const ML       = 48;
const MR       = 48;
const CW       = PAGE_W - ML - MR;   // 516
const HEADER_H = 72;
const FOOTER_H = 36;

// Text area for step descriptions
// Left edge = ML + 3(accent) + 8(pad) + 20(num) + 6(gap) + 54(pill) + 8(gap)
const TEXT_X     = ML + 3 + 8 + 20 + 6 + 54 + 8;   // ≈ 147
const TEXT_W     = ML + CW - TEXT_X - 8;             // ≈ 412
const MAX_CHARS  = Math.floor(TEXT_W / (9 * 0.52));  // ≈ 88 → use 80 for safety
const WRAP_AT    = 80;

// ── Process Flows ─────────────────────────────────────────────────────────────
const FLOWS = [
  {
    id: '01',
    title: 'App Launch & Session Verification',
    subtitle: 'Initial sequence every time the tenant opens the LilyCrest app',
    steps: [
      { type: 'system',  text: 'App launches — LilyCrest splash screen displayed with logo' },
      { type: 'system',  text: 'AuthContext initializes and reads session_token from AsyncStorage' },
      { type: 'branch',  text: 'No token found → user redirected immediately to the Login screen' },
      { type: 'api',     text: 'Token found → GET /auth/me called with Bearer token to validate session' },
      { type: 'success', text: 'Valid response (200) → user profile loaded into context, Home dashboard opened' },
      { type: 'error',   text: '401 Unauthorized → token removed from AsyncStorage, user sent to Login' },
    ],
  },
  {
    id: '02',
    title: 'Login — Email & Password',
    subtitle: 'Standard credential-based authentication using email and password',
    steps: [
      { type: 'system',  text: 'Login screen loads — email pre-filled if Remember Me was set on last visit' },
      { type: 'user',    text: 'User types email address (auto-trimmed, forced lowercase, no spaces allowed)' },
      { type: 'user',    text: 'User types password (minimum 6 characters, max 128)' },
      { type: 'user',    text: '(Optional) User checks "Remember Me" — email will be pre-filled next visit' },
      { type: 'user',    text: 'User taps "Sign In" button' },
      { type: 'system',  text: 'Local validation runs: email format check, password length check' },
      { type: 'branch',  text: 'Invalid fields → inline error messages shown below fields, submission blocked' },
      { type: 'api',     text: 'POST /auth/login → sends { email, password } to backend' },
      { type: 'success', text: '200 OK → session_token saved to AsyncStorage, user navigated to Home' },
      { type: 'branch',  text: '400 / 401 → red banner: "Invalid email or password. Please try again."' },
      { type: 'branch',  text: '403 → orange banner: account not registered as an active tenant' },
      { type: 'branch',  text: '429 → yellow banner: too many failed attempts, please wait before retrying' },
      { type: 'error',   text: 'Network error → blue banner: unable to connect, check internet connection' },
      { type: 'system',  text: 'On success: if biometric hardware available and not previously enrolled —' },
      { type: 'note',    text: 'Alert shown: "Enable Biometric Login?" with [Not Now] / [Enable] options' },
    ],
  },
  {
    id: '03',
    title: 'Login — Google Sign-In',
    subtitle: 'OAuth-based authentication via Firebase using a Google account',
    steps: [
      { type: 'user',    text: 'User taps "Continue with Google" button' },
      { type: 'system',  text: 'Google OAuth consent screen opens via Firebase (expo-auth-session)' },
      { type: 'user',    text: 'User selects their Google account and grants permission' },
      { type: 'system',  text: 'Firebase ID token retrieved from the authenticated Google session' },
      { type: 'api',     text: 'POST /auth/google → sends { idToken } to backend for tenant verification' },
      { type: 'success', text: '200 OK → session_token saved, user navigated to Home dashboard' },
      { type: 'branch',  text: '403 → orange banner: Google account is not registered as an active tenant' },
      { type: 'branch',  text: 'User cancels Google prompt → no error shown, login form remains visible' },
      { type: 'error',   text: 'Token failure → blue banner: authentication failed, try again or use email' },
    ],
  },
  {
    id: '04',
    title: 'Login — Biometric Authentication',
    subtitle: 'Fingerprint or Face ID sign-in using securely stored credentials',
    steps: [
      { type: 'note',    text: 'Prerequisite: biometric hardware enrolled and credentials saved via prior login' },
      { type: 'user',    text: 'User taps "Sign in with biometrics" button on the Login screen' },
      { type: 'system',  text: 'Device biometric prompt displayed (fingerprint scanner or Face ID dialog)' },
      { type: 'branch',  text: 'Biometric verification failed → red banner shown, user can retry or use password' },
      { type: 'system',  text: 'Success → stored credentials retrieved from SecureStore (Keychain / Keystore)' },
      { type: 'api',     text: 'POST /auth/login called silently in background with stored email and password' },
      { type: 'success', text: '200 OK → session established, user navigated to Home dashboard seamlessly' },
      { type: 'error',   text: '401 → password changed elsewhere → SecureStore cleared, orange banner shown' },
    ],
  },
  {
    id: '05',
    title: 'Forgot Password & Reset Flow',
    subtitle: 'Email-based password reset from request submission to successful re-login',
    steps: [
      { type: 'user',    text: 'User taps "Forgot password?" link on the Login screen' },
      { type: 'user',    text: 'Forgot Password screen: user types their registered email address' },
      { type: 'api',     text: 'POST /auth/forgot-password → backend sends reset link to that email address' },
      { type: 'user',    text: 'User opens email inbox and taps the password reset link' },
      { type: 'system',  text: 'System browser or WebView opens the password reset form page' },
      { type: 'user',    text: 'User types new password (8+ chars, uppercase, lowercase, number, special char)' },
      { type: 'user',    text: 'User submits the reset form' },
      { type: 'api',     text: 'Backend validates reset token, updates password in MongoDB, returns confirmation' },
      { type: 'system',  text: 'All active sessions deleted from user_sessions collection in database' },
      { type: 'system',  text: 'Biometric credentials cleared from SecureStore (old password now invalid)' },
      { type: 'user',    text: 'User returns to the LilyCrest app and logs in with the new password' },
    ],
  },
  {
    id: '06',
    title: 'Enable Biometric Login (Post-Login Setup)',
    subtitle: 'First-time biometric enrollment triggered automatically after successful login',
    steps: [
      { type: 'system',  text: 'After successful email/password login, app checks biometric availability' },
      { type: 'branch',  text: 'No biometric hardware → skip silently, navigate to Home directly' },
      { type: 'branch',  text: 'Biometric previously enabled → refresh stored credentials silently, go to Home' },
      { type: 'system',  text: 'First time: Alert shown — "Enable Biometric Login?" with [Not Now] / [Enable]' },
      { type: 'user',    text: 'User taps [Not Now] → navigated to Home, biometric login remains disabled' },
      { type: 'user',    text: 'User taps [Enable] → device biometric prompt shown to confirm identity' },
      { type: 'system',  text: 'Biometric success → email + password saved to SecureStore (Keychain/Keystore)' },
      { type: 'system',  text: 'biometricLogin flag set to "true" in AsyncStorage' },
      { type: 'success', text: '"Sign in with biometrics" button now appears on Login screen for future visits' },
    ],
  },
  {
    id: '07',
    title: 'Home Dashboard',
    subtitle: 'Main screen after login — overview of tenant status and recent activity',
    steps: [
      { type: 'system',  text: 'Home screen mounts — three concurrent data requests initiated' },
      { type: 'api',     text: 'GET /auth/me → verify session and refresh current user profile data' },
      { type: 'api',     text: 'GET /billing/current-bill → fetch the most recent billing statement' },
      { type: 'api',     text: 'GET /announcements → fetch recent dormitory announcements' },
      { type: 'system',  text: 'Welcome banner displayed with tenant name and Active Tenant badge' },
      { type: 'system',  text: 'Current bill card shown: total amount due, due date, payment status badge' },
      { type: 'system',  text: 'Announcements strip shows up to 3 latest items with priority badges' },
      { type: 'user',    text: 'User pulls down to refresh all sections simultaneously' },
      { type: 'user',    text: 'Quick-action buttons: Pay Bill → Billing | Services → Requests | Lily → AI Chat' },
    ],
  },
  {
    id: '08',
    title: 'Billing — View History & Bill Details',
    subtitle: 'Browsing all billing statements and reading detailed charge breakdowns',
    steps: [
      { type: 'user',    text: 'User navigates to the Billing tab from the bottom navigation bar' },
      { type: 'api',     text: 'GET /billing/history → full billing history fetched with auth token' },
      { type: 'system',  text: 'Bills displayed as cards sorted by date, newest first' },
      { type: 'user',    text: 'User filters by status using tab buttons: All | Pending | Overdue | Paid' },
      { type: 'user',    text: 'User taps a bill card to open the Bill Details screen' },
      { type: 'system',  text: 'Charge breakdown rendered: monthly rent, electricity, water, penalties, total' },
      { type: 'system',  text: 'Electricity: previous reading, current reading, kWh consumed, rate, amount' },
      { type: 'system',  text: 'Water: cubic meters consumed, rate per cubic meter, computed amount' },
      { type: 'system',  text: 'Status badge: Pending (yellow) | Overdue (red) | Paid (green)' },
      { type: 'system',  text: 'Paid bills also display payment date and PayMongo reference number' },
    ],
  },
  {
    id: '09',
    title: 'Billing — Pay Bill Online via PayMongo',
    subtitle: 'End-to-end online payment from bill selection to payment confirmation',
    steps: [
      { type: 'user',    text: 'User taps "Pay Now" on a Pending or Overdue bill' },
      { type: 'system',  text: 'Payment screen opens — bill summary and total amount displayed' },
      { type: 'user',    text: 'User selects payment method: GCash | Maya | GrabPay | Credit / Debit Card' },
      { type: 'user',    text: 'User taps "Proceed to Payment"' },
      { type: 'api',     text: 'POST /paymongo/checkout → backend creates a PayMongo checkout session' },
      { type: 'system',  text: 'Checkout URL returned → app opens PayMongo secure payment page in browser' },
      { type: 'user',    text: 'User completes payment (OTP verification, card entry, or e-wallet auth)' },
      { type: 'system',  text: 'PayMongo redirects back to app via deep link after payment completion' },
      { type: 'api',     text: 'Backend receives PayMongo webhook → updates bill status to Paid in database' },
      { type: 'success', text: 'App refreshes bill list — paid bill now shows green Paid badge' },
    ],
  },
  {
    id: '10',
    title: 'Billing — Download PDF Receipt',
    subtitle: 'Generating and saving a branded PDF bill receipt to the device',
    steps: [
      { type: 'user',    text: 'User taps "Download Receipt" on a paid bill in the Bill Details screen' },
      { type: 'system',  text: 'App retrieves current session_token from AsyncStorage' },
      { type: 'api',     text: 'GET /billing/download/:billId → authenticated request to backend' },
      { type: 'system',  text: 'Backend generates branded LilyCrest PDF with full charge breakdown' },
      { type: 'system',  text: 'PDF binary stream written to device cache directory via expo-file-system' },
      { type: 'success', text: 'Native share sheet opens — user saves to Files, shares via messaging, etc.' },
      { type: 'error',   text: 'On failure: error message shown, cached file cleared for clean next attempt' },
    ],
  },
  {
    id: '11',
    title: 'Room & Bed Management',
    subtitle: 'Viewing assigned room, bed position, and tenancy details (view only)',
    steps: [
      { type: 'user',    text: 'User navigates to the Profile tab or Room section within the app' },
      { type: 'api',     text: 'GET /user/assignment → fetches room assignment data for the tenant account' },
      { type: 'system',  text: 'Room card: room number, floor level, room type (Quad / Double / Private)' },
      { type: 'system',  text: 'Bed card: bed position (Upper / Lower), number of current occupants (pax)' },
      { type: 'system',  text: 'Tenancy dates: move-in date and scheduled move-out date' },
      { type: 'system',  text: 'Active Tenant badge shown when current date is within tenancy period' },
      { type: 'user',    text: 'User taps "Submit Service Request" shortcut to report a room or bed concern' },
    ],
  },
  {
    id: '12',
    title: 'Maintenance & Service Requests — Submit',
    subtitle: 'Creating a new maintenance or service request for admin review and action',
    steps: [
      { type: 'user',    text: 'User navigates to the Services tab and taps "New Request"' },
      { type: 'user',    text: 'User selects type: Maintenance | Plumbing | Electrical | Aircon | Cleaning | Pest | Furniture' },
      { type: 'user',    text: 'User sets urgency: Low (72 hr SLA) | Normal (48 hr SLA) | Urgent (24 hr SLA)' },
      { type: 'user',    text: 'User writes a clear description of the problem or concern' },
      { type: 'user',    text: '(Optional) User attaches photos or files from device gallery or camera' },
      { type: 'user',    text: 'User taps "Submit Request"' },
      { type: 'api',     text: 'POST /service-requests → request created with Pending status in database' },
      { type: 'success', text: 'Request appears in list with Pending badge and estimated resolution time shown' },
    ],
  },
  {
    id: '13',
    title: 'Maintenance & Service Requests — Track & Manage',
    subtitle: 'Monitoring request progress, viewing admin responses, cancelling or reopening',
    steps: [
      { type: 'api',     text: 'GET /service-requests → all tenant requests loaded when Services screen opens' },
      { type: 'system',  text: 'Each request card shows: type icon, urgency badge, status, and submission date' },
      { type: 'user',    text: 'User taps a request card to view full details' },
      { type: 'system',  text: 'Detail screen: full description, attached photos, status timeline, admin replies' },
      { type: 'system',  text: 'Estimated resolution time: Urgent = 24 hrs | Normal = 48 hrs | Low = 72 hrs' },
      { type: 'user',    text: 'On a Pending request: user taps "Cancel Request" to withdraw it' },
      { type: 'api',     text: 'PUT /service-requests/:id → status updated to Cancelled in database' },
      { type: 'user',    text: 'On a Resolved request: user taps "Reopen Request" for follow-up action' },
      { type: 'api',     text: 'PUT /service-requests/:id → status reset to Pending for admin re-review' },
    ],
  },
  {
    id: '14',
    title: 'Announcements & Dormitory Policies',
    subtitle: 'Viewing official notices, dorm rules, and tenant documents',
    steps: [
      { type: 'user',    text: 'User navigates to the Announcements tab' },
      { type: 'api',     text: 'GET /announcements → fetches all active announcements from the backend' },
      { type: 'system',  text: 'Announcements listed by date; each card shows title, category, priority, date' },
      { type: 'user',    text: 'User filters by category: All | Billing | Maintenance | Rules | Promo | General' },
      { type: 'system',  text: 'Priority badges: Urgent (red) | Normal (blue) | Low (gray)' },
      { type: 'user',    text: 'User navigates to Policies section (in Profile) for official dorm documents' },
      { type: 'system',  text: 'Policy documents: House Rules, Privacy Policy, Terms of Service' },
      { type: 'system',  text: 'Dorm contracts: Lease Contract, Curfew Policy, Visitor Policy' },
      { type: 'user',    text: 'User can view and upload personal documents: government IDs, personal files' },
    ],
  },
  {
    id: '15',
    title: 'Profile — Edit Information',
    subtitle: 'Updating personal profile details such as name, phone, and photo',
    steps: [
      { type: 'user',    text: 'User navigates to the Profile tab' },
      { type: 'api',     text: 'GET /auth/me → profile data loaded: name, email, phone number, profile photo' },
      { type: 'system',  text: 'Profile screen displays all tenant info with an Edit button in the top right' },
      { type: 'user',    text: 'User taps "Edit Profile" — name, phone, and photo fields become editable' },
      { type: 'user',    text: 'User updates desired fields (email cannot be changed after registration)' },
      { type: 'user',    text: 'User taps "Save Changes"' },
      { type: 'api',     text: 'PUT /user/profile → updated profile sent to backend and persisted in database' },
      { type: 'success', text: 'Profile refreshed immediately with updated values — no page reload needed' },
    ],
  },
  {
    id: '16',
    title: 'Profile — Change Password',
    subtitle: 'Securely updating account password with immediate session invalidation',
    steps: [
      { type: 'user',    text: 'User taps "Change Password" in the Profile screen' },
      { type: 'user',    text: 'User enters current password in the first field' },
      { type: 'user',    text: 'User enters new password — live checklist validates all 5 requirements' },
      { type: 'system',  text: 'Requirements: 8+ characters, uppercase, lowercase, number, special character' },
      { type: 'user',    text: 'User confirms new password — green "Passwords match" indicator shown' },
      { type: 'user',    text: 'User taps "Update Password" (button enabled only when all checks pass)' },
      { type: 'api',     text: 'POST /auth/change-password → validated and updated in MongoDB' },
      { type: 'system',  text: 'Backend deletes all rows from user_sessions collection (all devices signed out)' },
      { type: 'system',  text: 'Biometric credentials cleared from SecureStore (old password now invalid)' },
      { type: 'system',  text: 'Confirmation email sent to tenant\'s registered email address' },
      { type: 'success', text: 'Alert shown → user taps "Sign In Again" → logout → redirected to Login screen' },
    ],
  },
  {
    id: '17',
    title: 'Settings — Preferences & Biometric Management',
    subtitle: 'Managing app theme, notifications, and biometric login settings',
    steps: [
      { type: 'user',    text: 'User navigates to the Settings screen from the Profile tab' },
      { type: 'system',  text: 'Current settings loaded: dark mode state, notifications, biometric status' },
      { type: 'user',    text: 'Dark Mode toggle → switches between light and dark theme instantly' },
      { type: 'system',  text: 'Theme preference saved to AsyncStorage, applied on every app session' },
      { type: 'user',    text: 'Notifications toggle → enables or disables push notification delivery' },
      { type: 'user',    text: 'Biometric Login toggle (enable) → device biometric prompt shown for confirmation' },
      { type: 'system',  text: 'On success: biometricLogin flag set to "true" in AsyncStorage' },
      { type: 'note',    text: 'Credentials stored on next password login; prompt also appears post-login' },
      { type: 'user',    text: 'Biometric Login toggle (disable) → credentials wiped from SecureStore immediately' },
      { type: 'system',  text: 'biometricLogin flag set to "false" — biometric button hidden on Login screen' },
    ],
  },
  {
    id: '18',
    title: 'Support — Lily AI Assistant (Chatbot)',
    subtitle: 'Conversational AI for billing, room, and policy questions powered by Gemini',
    steps: [
      { type: 'user',    text: 'User opens Lily Assistant from Home quick actions or bottom navigation' },
      { type: 'system',  text: 'Chat interface loads with a personalized greeting message from Lily' },
      { type: 'user',    text: 'User types a question about billing, room assignments, rules, or general info' },
      { type: 'api',     text: 'POST /chatbot/message → message + conversation history sent to backend' },
      { type: 'system',  text: 'Backend enriches prompt with tenant\'s billing data, room info, and policies' },
      { type: 'api',     text: 'Gemini AI processes enriched prompt and returns a contextual, accurate response' },
      { type: 'system',  text: 'Response rendered as a chat bubble with the Lily avatar' },
      { type: 'user',    text: 'Conversation continues — full context window maintained within the session' },
      { type: 'user',    text: 'User taps "Reset Chat" to clear history and start a fresh conversation' },
    ],
  },
  {
    id: '19',
    title: 'Support — FAQ & Support Ticket System',
    subtitle: 'Browsing knowledge base articles and submitting formal support requests',
    steps: [
      { type: 'user',    text: 'User navigates to the FAQ section within Support' },
      { type: 'api',     text: 'GET /faq → fetches all FAQ entries and available filter categories' },
      { type: 'system',  text: 'FAQs rendered as expandable accordion list — tap to expand/collapse' },
      { type: 'user',    text: 'User filters FAQs by category: General | Billing | Room | Rules | Maintenance' },
      { type: 'user',    text: 'User taps "Create Support Ticket" — subject and description fields appear' },
      { type: 'api',     text: 'POST /tickets → ticket saved with Open status and ticket ID assigned' },
      { type: 'system',  text: 'Ticket visible in list — status tracked: Open | In Progress | Resolved | Closed' },
      { type: 'system',  text: 'Admin response triggers a push notification to the tenant' },
      { type: 'user',    text: 'User opens ticket and taps "Reply" to add more context to the thread' },
      { type: 'user',    text: 'User taps "Close Ticket" when the issue is resolved' },
      { type: 'api',     text: 'PUT /tickets/:id/status → ticket status updated to Closed in database' },
    ],
  },
  {
    id: '20',
    title: 'Sign Out',
    subtitle: 'Secure session termination and complete credential cleanup',
    steps: [
      { type: 'user',    text: 'User taps "Sign Out" in the Profile tab or Settings screen' },
      { type: 'api',     text: 'POST /auth/logout → active session invalidated on backend (best effort call)' },
      { type: 'system',  text: 'session_token removed from AsyncStorage — session no longer valid locally' },
      { type: 'system',  text: 'Biometric credentials cleared from SecureStore (Keychain / Keystore)' },
      { type: 'system',  text: 'Firebase signOut() called — applies only to Google-authenticated users' },
      { type: 'system',  text: 'AuthContext sets user = null and authStatus = "unauthenticated"' },
      { type: 'success', text: 'App navigates to Login screen — back navigation disabled (stack replaced)' },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function rgb(c) { return `${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)}`; }

function esc(t) {
  return String(t || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '?');
}

function wrapText(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? current + ' ' + word : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ── PDF Builder ───────────────────────────────────────────────────────────────
function buildPdf() {
  const pages = [];
  let page = [];
  let y = 0;

  const CONTENT_TOP = PAGE_H - HEADER_H - 16;
  const CONTENT_BOT = FOOTER_H + 16;

  // ── newPage — IMPORTANT: reassigns outer `page`; callers must use `page` directly
  function newPage(isFirst = false) {
    if (page.length) pages.push(page.join('\n'));
    page = [];
    y = CONTENT_TOP;
    drawHeader(page, isFirst);
  }

  function ensureSpace(need) {
    if (y - need < CONTENT_BOT) newPage(false);
  }

  // ── Header ──
  function drawHeader(p, isFirst) {
    p.push(`${rgb(NAVY)} rg`);
    p.push(`0 ${PAGE_H - HEADER_H} ${PAGE_W} ${HEADER_H} re f`);
    p.push(`${rgb(ORANGE)} rg`);
    p.push(`0 ${PAGE_H - HEADER_H - 3} ${PAGE_W} 3 re f`);
    const lx = ML, ly = PAGE_H - 26;
    p.push(`${rgb(ORANGE)} rg`);
    p.push(`${lx+10} ${ly+10} m ${lx+20} ${ly} l ${lx+10} ${ly-10} l ${lx} ${ly} l f`);
    p.push(`${rgb(NAVY)} rg`);
    p.push(`${lx+10} ${ly+5} m ${lx+15} ${ly} l ${lx+10} ${ly-5} l ${lx+5} ${ly} l f`);
    p.push('BT'); p.push(`${rgb(WHITE)} rg`); p.push('/F2 15 Tf');
    p.push(`${lx+28} ${ly-4} Td`); p.push(`(${esc('LilyCrest')}) Tj`); p.push('ET');
    p.push('BT'); p.push('0.65 0.65 0.65 rg'); p.push('/F1 7 Tf');
    p.push(`${lx+28} ${ly-14} Td`); p.push(`(${esc('DORMITORY MANAGEMENT SYSTEM')}) Tj`); p.push('ET');
    if (isFirst) {
      const label = 'MOBILE APP - SYSTEM PROCESS FLOW';
      const lw = label.length * 9 * 0.52;
      p.push('BT'); p.push(`${rgb(WHITE)} rg`); p.push('/F2 9 Tf');
      p.push(`${PAGE_W - MR - lw} ${ly-1} Td`); p.push(`(${esc(label)}) Tj`); p.push('ET');
      const dated = 'Generated: April 10, 2026';
      const dw = dated.length * 7 * 0.52;
      p.push('BT'); p.push('0.65 0.65 0.65 rg'); p.push('/F1 7 Tf');
      p.push(`${PAGE_W - MR - dw} ${ly-12} Td`); p.push(`(${esc(dated)}) Tj`); p.push('ET');
    }
  }

  // ── Footer ──
  function drawFooter(p, pageNum) {
    p.push(`${rgb(ORANGE)} rg`);
    p.push(`0 ${FOOTER_H - 4} ${PAGE_W} 2 re f`);
    p.push('BT'); p.push(`${rgb(MGRAY)} rg`); p.push('/F1 8 Tf');
    p.push(`${ML} ${FOOTER_H - 18} Td`);
    p.push(`(${esc('LilyCrest Dormitory Management System - Mobile Application')}) Tj`); p.push('ET');
    const pnText = `Page ${pageNum}`;
    const pw = pnText.length * 8 * 0.52;
    p.push('BT'); p.push(`${rgb(MGRAY)} rg`); p.push('/F1 8 Tf');
    p.push(`${PAGE_W - MR - pw} ${FOOTER_H - 18} Td`);
    p.push(`(${esc(pnText)}) Tj`); p.push('ET');
    p.push(`${rgb(LGRAY)} rg`);
    p.push(`${ML} ${FOOTER_H - 4} ${CW} 0.5 re f`);
  }

  // ── Cover Block ── (uses `page` from closure)
  function drawCoverBlock() {
    y -= 8;
    const titleY = y;
    // Title card
    page.push(`${rgb(LIGHT)} rg`);
    page.push(`${ML} ${titleY - 90} ${CW} 90 re f`);
    page.push(`${rgb(NAVY)} rg`);
    page.push(`${ML} ${titleY - 90} 4 90 re f`);
    page.push('BT'); page.push(`${rgb(NAVY)} rg`); page.push('/F2 20 Tf');
    page.push(`${ML + 18} ${titleY - 26} Td`);
    page.push(`(${esc('Mobile Application')}) Tj`); page.push('ET');
    page.push('BT'); page.push(`${rgb(NAVY)} rg`); page.push('/F2 14 Tf');
    page.push(`${ML + 18} ${titleY - 46} Td`);
    page.push(`(${esc('System Process Flow Document')}) Tj`); page.push('ET');
    page.push('BT'); page.push(`${rgb(MGRAY)} rg`); page.push('/F1 9 Tf');
    page.push(`${ML + 18} ${titleY - 62} Td`);
    page.push(`(${esc('Step-by-step processes for all tenant features — from app launch to sign out')}) Tj`); page.push('ET');
    page.push('BT'); page.push(`${rgb(MGRAY)} rg`); page.push('/F1 8 Tf');
    page.push(`${ML + 18} ${titleY - 78} Td`);
    page.push(`(${esc('April 10, 2026  |  Tenant-Facing Mobile App  |  React Native / Expo')}) Tj`); page.push('ET');
    y -= 106;

    // Legend heading
    y -= 12;
    page.push('BT'); page.push(`${rgb(NAVY)} rg`); page.push('/F2 9 Tf');
    page.push(`${ML} ${y} Td`); page.push(`(${esc('STEP TYPE LEGEND')}) Tj`); page.push('ET');
    page.push(`${rgb(ORANGE)} rg`);
    page.push(`${ML} ${y - 2} ${CW} 1 re f`);
    y -= 14;

    // Legend items — two columns
    const entries = Object.entries(STEP_TYPES);
    const colW = CW / 2;
    let col = 0;
    const savedY = y;
    entries.forEach(([key, cfg], i) => {
      col = i % 2;
      const rowNum = Math.floor(i / 2);
      const ry = savedY - rowNum * 16;
      const lx2 = ML + col * colW;
      const pillW = 52;
      page.push(`${rgb(cfg.color)} rg`);
      page.push(`${lx2} ${ry - 4} ${pillW} 13 re f`);
      const tw = cfg.label.length * 6.5 * 0.52;
      page.push('BT'); page.push(`${rgb(WHITE)} rg`); page.push('/F2 6.5 Tf');
      page.push(`${lx2 + (pillW - tw) / 2} ${ry} Td`);
      page.push(`(${esc(cfg.label)}) Tj`); page.push('ET');
      page.push('BT'); page.push(`${rgb(DGRAY)} rg`); page.push('/F1 8 Tf');
      page.push(`${lx2 + pillW + 6} ${ry} Td`);
      page.push(`(${esc(STEP_TYPE_DESC[key] || '')}) Tj`); page.push('ET');
    });
    const rowCount = Math.ceil(entries.length / 2);
    y -= rowCount * 16 + 10;

    // Summary stats
    const totalFlows = FLOWS.length;
    const totalSteps = FLOWS.reduce((s, f) => s + f.steps.length, 0);
    page.push(`${rgb(LIGHT)} rg`);
    page.push(`${ML} ${y - 48} ${CW} 48 re f`);
    page.push(`${rgb(LGRAY)} RG`); page.push('0.5 w');
    page.push(`${ML} ${y - 48} ${CW} 48 re S`);
    const col3 = CW / 3;
    [
      { label: 'Total Flows',  value: String(totalFlows),  color: NAVY,   fs: 20 },
      { label: 'Total Steps',  value: String(totalSteps),  color: ORANGE, fs: 20 },
      { label: 'App Platform', value: 'React Native',      color: TEAL,   fs: 10 },
    ].forEach((stat, i) => {
      const sx = ML + i * col3 + col3 / 2;
      const vw = stat.value.length * stat.fs * 0.52;
      page.push('BT'); page.push(`${rgb(stat.color)} rg`); page.push(`/F2 ${stat.fs} Tf`);
      page.push(`${sx - vw / 2} ${y - 24} Td`); page.push(`(${esc(stat.value)}) Tj`); page.push('ET');
      const lw2 = stat.label.length * 8 * 0.52;
      page.push('BT'); page.push(`${rgb(MGRAY)} rg`); page.push('/F1 8 Tf');
      page.push(`${sx - lw2 / 2} ${y - 38} Td`); page.push(`(${esc(stat.label)}) Tj`); page.push('ET');
    });
    y -= 62;
  }

  // ── Flow Section ── (uses `page` from closure — critical: avoids the page-break bug)
  function drawFlow(flow) {
    // Measure how much space we need
    let needed = 36;  // header bar
    flow.steps.forEach(step => {
      const lines = wrapText(step.text, WRAP_AT);
      needed += Math.max(22, 10 + lines.length * 12) + 1;
    });
    needed += 14;  // bottom gap

    // Keep the whole flow together on one page (if it fits on a full page)
    if (needed <= CONTENT_TOP - CONTENT_BOT) {
      ensureSpace(needed);
    } else {
      // Too tall for one page — just ensure space for header + first few steps
      ensureSpace(36 + 5 * 23);
    }

    // ── Flow header bar ──
    page.push(`${rgb(NAVY)} rg`);
    page.push(`${ML} ${y - 34} ${CW} 34 re f`);

    // Number pill (orange box)
    page.push(`${rgb(ORANGE)} rg`);
    page.push(`${ML + 6} ${y - 27} 28 21 re f`);
    const numW = flow.id.length * 9 * 0.52;
    page.push('BT'); page.push(`${rgb(WHITE)} rg`); page.push('/F2 9 Tf');
    page.push(`${ML + 6 + (28 - numW) / 2} ${y - 20} Td`);
    page.push(`(${esc(flow.id)}) Tj`); page.push('ET');

    // Flow title
    page.push('BT'); page.push(`${rgb(WHITE)} rg`); page.push('/F2 10 Tf');
    page.push(`${ML + 42} ${y - 16} Td`);
    page.push(`(${esc(flow.title)}) Tj`); page.push('ET');

    // Flow subtitle
    page.push('BT'); page.push('0.70 0.70 0.70 rg'); page.push('/F1 8 Tf');
    page.push(`${ML + 42} ${y - 28} Td`);
    page.push(`(${esc(flow.subtitle)}) Tj`); page.push('ET');

    y -= 34;
    y -= 2;

    // ── Step rows ──
    flow.steps.forEach((step, idx) => {
      const cfg = STEP_TYPES[step.type] || STEP_TYPES.system;
      const lines = wrapText(step.text, WRAP_AT);
      const rowH = Math.max(22, 10 + lines.length * 12);

      // Ensure this row fits; if it spills, break to next page
      ensureSpace(rowH + 1);

      // Alternate row background
      if (idx % 2 === 1) {
        page.push(`${rgb(VLIGHT)} rg`);
        page.push(`${ML} ${y - rowH} ${CW} ${rowH} re f`);
      }

      // Left color accent stripe (type color)
      page.push(`${rgb(cfg.color)} rg`);
      page.push(`${ML} ${y - rowH} 3 ${rowH} re f`);

      // Step number box
      const numBoxY = y - rowH + Math.floor((rowH - 16) / 2);
      page.push(`${rgb(NAVY)} rg`);
      page.push(`${ML + 7} ${numBoxY} 20 16 re f`);
      const stepN = String(idx + 1).padStart(2, '0');
      const snW = stepN.length * 7 * 0.52;
      page.push('BT'); page.push(`${rgb(WHITE)} rg`); page.push('/F2 7 Tf');
      page.push(`${ML + 7 + (20 - snW) / 2} ${numBoxY + 4} Td`);
      page.push(`(${esc(stepN)}) Tj`); page.push('ET');

      // Type pill
      const pillW = 54;
      const pillX = ML + 7 + 20 + 5;
      const pillY = y - rowH + Math.floor((rowH - 14) / 2);
      page.push(`${rgb(cfg.color)} rg`);
      page.push(`${pillX} ${pillY} ${pillW} 14 re f`);
      const labelW = cfg.label.length * 6.5 * 0.52;
      page.push('BT'); page.push(`${rgb(WHITE)} rg`); page.push('/F2 6.5 Tf');
      page.push(`${pillX + (pillW - labelW) / 2} ${pillY + 4} Td`);
      page.push(`(${esc(cfg.label)}) Tj`); page.push('ET');

      // Step description text (possibly multi-line)
      const textX = pillX + pillW + 8;
      let textY;
      if (lines.length === 1) {
        // Single line: vertically center in row
        textY = y - rowH + Math.floor((rowH - 9) / 2) + 2;
      } else {
        // Multi-line: start from near top with padding
        textY = y - 10;
      }
      lines.forEach((line, li) => {
        page.push('BT'); page.push(`${rgb(DGRAY)} rg`); page.push('/F1 9 Tf');
        page.push(`${textX} ${textY - li * 12} Td`);
        page.push(`(${esc(line)}) Tj`); page.push('ET');
      });

      // Row separator
      page.push(`${rgb(LGRAY)} RG`); page.push('0.3 w');
      page.push(`${ML} ${y - rowH} m ${ML + CW} ${y - rowH} l S`);

      y -= rowH;
    });

    y -= 12;
  }

  // ── Build pages ───────────────────────────────────────────────────────────
  newPage(true);
  drawCoverBlock();
  FLOWS.forEach(flow => drawFlow(flow));
  pages.push(page.join('\n'));

  // ── Assemble PDF ──────────────────────────────────────────────────────────
  const totalPages = pages.length;
  const streams = pages.map((s, i) => {
    const p = [];
    drawFooter(p, i + 1);
    return s + '\n' + p.join('\n');
  });

  const objects = [];
  let oid = 1;

  const obj = (id, dict, stream) => {
    let body = `${id} 0 obj\n${dict}`;
    if (stream !== undefined) body += `\nstream\n${stream}\nendstream`;
    body += '\nendobj';
    return body;
  };

  const fontF1 = oid++;
  const fontF2 = oid++;
  objects.push(obj(fontF1, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));
  objects.push(obj(fontF2, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'));
  const resources = `<< /Font << /F1 ${fontF1} 0 R /F2 ${fontF2} 0 R >> >>`;

  const pageOids = [];
  streams.forEach(s => {
    const contentId = oid++;
    objects.push(obj(contentId, `<< /Length ${s.length} >>`, s));
    const pageId = oid++;
    pageOids.push(pageId);
    objects.push(obj(pageId, `<< /Type /Page /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources ${resources} /Contents ${contentId} 0 R /Parent 999 0 R >>`));
  });

  const kidsStr  = pageOids.map(id => `${id} 0 R`).join(' ');
  const pagesObj = obj(999, `<< /Type /Pages /Kids [${kidsStr}] /Count ${pageOids.length} >>`);

  const catalogId = oid++;
  objects.push(obj(catalogId, `<< /Type /Catalog /Pages 999 0 R >>`));

  const header = '%PDF-1.4\n';
  let body = '';
  const offsets = {};

  offsets[999] = header.length + body.length;
  body += pagesObj + '\n';

  objects.forEach(o => {
    const m = o.match(/^(\d+) 0 obj/);
    if (m) offsets[parseInt(m[1])] = header.length + body.length;
    body += o + '\n';
  });

  const xrefStart = header.length + body.length;
  const allIds = [999, ...Object.keys(offsets).filter(k => k !== '999').map(Number)].sort((a, b) => a - b);
  const maxId  = Math.max(...allIds);

  let xref = `xref\n0 ${maxId + 2}\n0000000000 65535 f \n`;
  for (let i = 1; i <= maxId + 1; i++) {
    const off = offsets[i];
    xref += off !== undefined
      ? `${String(off).padStart(10, '0')} 00000 n \n`
      : `0000000000 65535 f \n`;
  }

  const trailer = `trailer\n<< /Size ${maxId + 2} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(header + body + xref + trailer, 'latin1');
}

// ── Write File ────────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, 'LilyCrest_System_Process_Flow.pdf');
const pdfBuffer = buildPdf();
fs.writeFileSync(outPath, pdfBuffer);
console.log(`PDF generated: ${outPath}`);
console.log(`Pages: will depend on content`);
console.log(`Size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);
