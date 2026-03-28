const admin = require('firebase-admin');

let firebaseApp;

function buildServiceAccountFromEnv() {
  const {
    FIREBASE_TYPE,
    FIREBASE_PROJECT_ID,
    FIREBASE_PRIVATE_KEY_ID,
    FIREBASE_PRIVATE_KEY,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_CLIENT_ID,
    FIREBASE_AUTH_URI,
    FIREBASE_TOKEN_URI,
    FIREBASE_AUTH_PROVIDER_CERT_URL,
    FIREBASE_CLIENT_CERT_URL,
    FIREBASE_UNIVERSE_DOMAIN,
  } = process.env;

  const requiredFields = [
    FIREBASE_PROJECT_ID,
    FIREBASE_PRIVATE_KEY_ID,
    FIREBASE_PRIVATE_KEY,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_CLIENT_ID,
    FIREBASE_AUTH_URI,
    FIREBASE_TOKEN_URI,
    FIREBASE_AUTH_PROVIDER_CERT_URL,
    FIREBASE_CLIENT_CERT_URL,
  ];

  if (requiredFields.some((value) => !value)) {
    return null;
  }

  return {
    type: FIREBASE_TYPE || 'service_account',
    project_id: FIREBASE_PROJECT_ID,
    private_key_id: FIREBASE_PRIVATE_KEY_ID,
    private_key: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: FIREBASE_CLIENT_EMAIL,
    client_id: FIREBASE_CLIENT_ID,
    auth_uri: FIREBASE_AUTH_URI,
    token_uri: FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: FIREBASE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: FIREBASE_CLIENT_CERT_URL,
    universe_domain: FIREBASE_UNIVERSE_DOMAIN,
  };
}

// Firebase Admin SDK initialization
function initializeFirebase() {
  if (firebaseApp) {
    return firebaseApp;
  }

  const serviceAccount = buildServiceAccountFromEnv();

  if (!serviceAccount) {
    throw new Error('Firebase credentials are missing. Set FIREBASE_* env vars with a valid Admin SDK key.');
  }

  try {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin SDK initialized successfully');
    return firebaseApp;
  } catch (error) {
    console.error('Firebase initialization error:', error.message);
    throw error;
  }
}

// Verify Firebase ID token
async function verifyFirebaseIdToken(idToken) {
  if (!firebaseApp) {
    throw new Error('Firebase not initialized');
  }
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error('Firebase ID token verification error:', error);
    throw error;
  }
}

// Verify tenant in Firebase
async function verifyTenantInFirebase(email) {
  if (!firebaseApp) {
    console.log('Firebase not initialized, skipping verification');
    return null;
  }
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    return {
      firebase_id: userRecord.uid,
      email: userRecord.email,
      name: userRecord.displayName || null,
      phone: userRecord.phoneNumber || null,
      picture: userRecord.photoURL || null,
    };
  } catch (error) {
    console.log(`User not found in Firebase Auth: ${email}`);
    return null;
  }
}

// Get Firebase app instance
function getFirebaseApp() {
  return firebaseApp;
}

module.exports = {
  initializeFirebase,
  verifyFirebaseIdToken,
  verifyTenantInFirebase,
  getFirebaseApp,
  admin
};
