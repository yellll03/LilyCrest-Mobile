
import { GoogleAuthProvider, signInWithCredential, signInWithPopup } from 'firebase/auth';
import { useState } from 'react';
import { Platform } from 'react-native';
import { auth, GOOGLE_WEB_CLIENT_ID } from './firebase';
import { classifyGoogleAuthError } from '../utils/googleAuthError';

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;

let GoogleSignin;
let statusCodes;
let nativeConfigurationError = null;
if (Platform.OS !== 'web') {
  try {
    const googleSignInModule = require('@react-native-google-signin/google-signin');
    GoogleSignin = googleSignInModule.GoogleSignin;
    statusCodes = googleSignInModule.statusCodes;
    // Configure once at module load — not on every render
    if (GOOGLE_WEB_CLIENT_ID) {
      GoogleSignin.configure({
        webClientId: GOOGLE_WEB_CLIENT_ID,
        offlineAccess: false,
        forceCodeForRefreshToken: false,
        profileImageSize: 120,
        scopes: ['profile', 'email'],
      });
    } else {
      console.warn('Google Sign-In skipped configure because webClientId is missing.');
    }
  } catch (nativeModuleError) {
    nativeConfigurationError = nativeModuleError;
    const classified = classifyGoogleAuthError(nativeModuleError, statusCodes, 'native-configuration');
    console.warn('[GoogleAuth]', {
      stage: classified.stage,
      code: classified.code,
      type: classified.type,
    });
  }
}

/**
 * Google Sign-In Hook
 * - Web: Firebase popup (testing only)
 * - Native (Expo dev client): Native Google Sign-In SDK (no browser redirect)
 */
export function useGoogleSignIn() {
  const isWeb = Platform.OS === 'web';
  const [isLoading, setIsLoading] = useState(false);

  const signInWithGoogle = async () => {
    let stage = 'native-configuration';
    try {
      // Web: prefer Firebase popup for parity with existing behavior
      if (isWeb) {
        return await signInWithGoogleWeb();
      }

      setIsLoading(true);
      if (nativeConfigurationError) {
        const classified = classifyGoogleAuthError(nativeConfigurationError, statusCodes, stage);
        return { success: false, ...classified, error: classified.message };
      }
      if (!GoogleSignin) {
        return {
          success: false,
          type: 'configuration',
          stage,
          code: 'native-module-unavailable',
          error: 'Google Sign-In is unavailable in this app build. Please install the latest version.',
        };
      }

      if (!GOOGLE_WEB_CLIENT_ID) {
        return {
          success: false,
          type: 'configuration',
          stage,
          code: 'web-client-id-missing',
          error: 'Google Sign-In is not configured in this app build. Please install the latest version.',
        };
      }

      if (Platform.OS === 'android') {
        stage = 'play-services';
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      }

      try {
        await GoogleSignin.signOut();
      } catch (_e) {
        // Ignore sign-out failures before account selection.
      }

      stage = 'account-selection';
      const googleResult = await GoogleSignin.signIn();

      if (googleResult?.type === 'cancelled') {
        return { success: false, cancelled: true, error: 'Sign-in cancelled' };
      }

      // v14+ can return 'noSavedCredentialFound' — treat as cancelled
      if (googleResult?.type === 'noSavedCredentialFound' || !googleResult?.data) {
        return { success: false, cancelled: true, error: 'Sign-in cancelled' };
      }

      const signInData = googleResult.data;
      stage = 'token-retrieval';
      let idToken = signInData?.idToken;
      let accessToken = signInData?.accessToken;

      // Fallback 1: getTokens() — in v16 idToken may be absent from signIn result
      if (!idToken) {
        try {
          const tokens = await GoogleSignin.getTokens();
          idToken = tokens?.idToken;
          accessToken = tokens?.accessToken;
          if (IS_DEV) console.log('[Google] getTokens() idToken present:', !!idToken);
        } catch (tokenErr) {
          console.warn('[Google] getTokens() failed:', tokenErr?.message);
        }
      }

      // Fallback 2: signInSilently() to force a fresh token from Google Play Services
      if (!idToken) {
        try {
          const silentResult = await GoogleSignin.signInSilently();
          if (silentResult?.type === 'success') {
            idToken = silentResult.data?.idToken;
            if (!idToken) {
              const tokens = await GoogleSignin.getTokens();
              idToken = tokens?.idToken;
              accessToken = tokens?.accessToken;
            }
          }
          if (IS_DEV) console.log('[Google] signInSilently() idToken present:', !!idToken);
        } catch (silentErr) {
          console.warn('[Google] signInSilently() failed:', silentErr?.message);
        }
      }

      if (!idToken && !accessToken) {
        console.warn('[GoogleAuth]', { stage, code: 'token-missing', type: 'credential' });
        return {
          success: false,
          type: 'credential',
          stage,
          code: 'token-missing',
          error: 'Google did not return a sign-in credential. Please try again.',
        };
      }

      // Some Android/Play Services flows return only an access token.
      // Firebase accepts either the Google ID token, the access token, or both.
      stage = 'firebase-credential';
      const credential = GoogleAuthProvider.credential(idToken ?? null, accessToken ?? null);
      const userCredential = await signInWithCredential(auth, credential);

      // Get Firebase ID token — this is what the backend verifyFirebaseIdToken() expects.
      // The Google idToken above is a Google token, not a Firebase one.
      const firebaseIdToken = await userCredential.user.getIdToken(true);

      return {
        success: true,
        stage: 'firebase-authenticated',
        user: userCredential.user,
        idToken: firebaseIdToken,
        accessToken,
      };
    } catch (error) {
      const classified = classifyGoogleAuthError(error, statusCodes, stage);
      console.warn('[GoogleAuth]', {
        stage: classified.stage,
        code: classified.code,
        type: classified.type,
      });
      return { success: false, ...classified, error: classified.message };
    } finally {
      setIsLoading(false);
    }
  };

  // Web: Firebase popup (testing/dev only)
  const signInWithGoogleWeb = async () => {
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('profile');
      provider.addScope('email');

      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);

      return {
        success: true,
        user: result.user,
        idToken: credential?.idToken,
        accessToken: credential?.accessToken,
      };
    } catch (error) {
      if (error.code === 'auth/popup-closed-by-user') {
        return { success: false, cancelled: true, error: 'Sign-in cancelled' };
      }
      if (error.code === 'auth/popup-blocked') {
        return { success: false, error: 'Popup blocked; allow popups to continue.' };
      }
      return { success: false, error: error.message || 'Web sign-in failed' };
    }
  };

  // Compatibility stub for components that expect redirect handling (no-op in Expo managed flow)
  const checkRedirectResult = async () => null;

  return { signInWithGoogle, isLoading, checkRedirectResult };
}

export async function signOutFromGoogle() {
  try {
    await auth.signOut();
    if (Platform.OS !== 'web' && GoogleSignin) {
      try {
        await GoogleSignin.signOut();
      } catch (nativeErr) {
        console.warn('Native Google sign-out warning:', nativeErr?.message);
      }
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to sign out' };
  }
}

export function getCurrentUser() {
  return auth.currentUser;
}

export function isSignedIn() {
  return auth.currentUser !== null;
}
