
import { GoogleAuthProvider, signInWithCredential, signInWithPopup } from 'firebase/auth';
import { useState } from 'react';
import { Platform } from 'react-native';
import { auth, GOOGLE_WEB_CLIENT_ID } from './firebase';

let GoogleSignin;
let statusCodes;
if (Platform.OS !== 'web') {
  try {
    const googleSignInModule = require('@react-native-google-signin/google-signin');
    GoogleSignin = googleSignInModule.GoogleSignin;
    statusCodes = googleSignInModule.statusCodes;
    // Configure once at module load — not on every render
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      offlineAccess: false,
      forceCodeForRefreshToken: false,
      profileImageSize: 120,
    });
  } catch (nativeModuleError) {
    console.warn('Native Google Sign-In module not available:', nativeModuleError?.message);
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
    try {
      // Web: prefer Firebase popup for parity with existing behavior
      if (isWeb) {
        return await signInWithGoogleWeb();
      }

      setIsLoading(true);
      if (!GoogleSignin) {
        return {
          success: false,
          error: 'Native Google Sign-In is unavailable. Rebuild and install the dev client.',
        };
      }

      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      try {
        await GoogleSignin.signOut();
      } catch (_e) {
        // Ignore sign-out failures before account selection.
      }

      const googleResult = await GoogleSignin.signIn();

      if (googleResult?.type === 'cancelled') {
        return { success: false, cancelled: true, error: 'Sign-in cancelled' };
      }

      const signInData = googleResult?.data;
      let idToken = signInData?.idToken;
      let accessToken;

      if (!idToken && GoogleSignin.getTokens) {
        try {
          const tokens = await GoogleSignin.getTokens();
          idToken = tokens?.idToken;
          accessToken = tokens?.accessToken;
        } catch (tokenErr) {
          console.warn('Unable to read Google tokens:', tokenErr?.message);
        }
      }

      if (!idToken) {
        return { success: false, error: 'No ID token returned from Google.' };
      }

      const credential = GoogleAuthProvider.credential(idToken);
      const userCredential = await signInWithCredential(auth, credential);

      return {
        success: true,
        user: userCredential.user,
        idToken,
        accessToken,
      };
    } catch (error) {
      if (statusCodes && error?.code === statusCodes.SIGN_IN_CANCELLED) {
        return { success: false, cancelled: true, error: 'Sign-in cancelled' };
      }
      if (error?.message?.toLowerCase().includes('canceled') || error?.message?.toLowerCase().includes('cancelled')) {
        return { success: false, cancelled: true, error: 'Sign-in cancelled' };
      }
      console.error('Google Sign-In Error:', error);
      return { success: false, error: error.message || 'Failed to sign in with Google' };
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
