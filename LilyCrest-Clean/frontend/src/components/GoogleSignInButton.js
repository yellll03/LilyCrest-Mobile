/**
 * Example: Google Sign-In Button Component
 * 
 * This shows how to integrate the useGoogleSignIn hook with your AuthContext
 * Use this pattern in your login screen or any component that needs Google Sign-In
 */

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useGoogleSignIn } from '../config/googleSignIn';
import { useAuth } from '../context/AuthContext';

export default function GoogleSignInButton({ 
  onSuccess, 
  onError,
  style,
  disabled = false 
}) {
  const [isSigningIn, setIsSigningIn] = useState(false);
  
  // Get the Google Sign-In hook
  const { signInWithGoogle, isLoading: isConfiguring, checkRedirectResult } = useGoogleSignIn();
  
  // Get the auth context for backend authentication
  const { signInWithGoogle: backendSignIn } = useAuth();

  // Check for redirect result on web when component mounts
  useEffect(() => {
    if (Platform.OS === 'web') {
      handleRedirectResult();
    }
  }, []);

  /**
   * Handle redirect result on web (if using redirect instead of popup)
   */
  const handleRedirectResult = async () => {
    try {
      const result = await checkRedirectResult();
      if (result?.success) {
        // User came back from OAuth redirect
        await handleSuccessfulGoogleSignIn(result);
      }
    } catch (error) {
      console.error('Redirect result error:', error);
    }
  };

  /**
   * Handle the complete Google Sign-In flow
   */
  const handleGoogleSignIn = async () => {
    if (isSigningIn || isConfiguring || disabled) {
      return;
    }

    try {
      setIsSigningIn(true);

      // ============================================
      // STEP 1: Sign in with Google
      // ============================================
      console.log('Starting Google Sign-In...');
      const googleResult = await signInWithGoogle();

      // Handle cancellation
      if (googleResult.cancelled) {
        console.log('User cancelled sign-in');
        setIsSigningIn(false);
        return;
      }

      // Handle error
      if (!googleResult.success) {
        throw new Error(googleResult.error || 'Google Sign-In failed');
      }

      console.log('Google Sign-In successful');

      // ============================================
      // STEP 2: Process the result and authenticate with backend
      // ============================================
      await handleSuccessfulGoogleSignIn(googleResult);

    } catch (error) {
      console.error('Google Sign-In Error:', error);
      
      const errorMessage = error.message || 'Failed to sign in with Google. Please try again.';
      
      Alert.alert(
        'Sign-In Failed',
        errorMessage,
        [{ text: 'OK', style: 'default' }]
      );

      if (onError) {
        onError(error);
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  /**
   * Process successful Google sign-in with backend
   */
  const handleSuccessfulGoogleSignIn = async (googleResult) => {
    try {
      // ============================================
      // On Web: Firebase already signed in, just get Firebase user
      // On Native: We already have Firebase user from signInWithGoogle
      // ============================================
      const firebaseUser = googleResult.user;

      if (!firebaseUser) {
        throw new Error('No user data received from Google');
      }

      // Get the ID token from Firebase for backend authentication
      const idToken = await firebaseUser.getIdToken();

      if (!idToken) {
        throw new Error('Failed to get ID token from Firebase');
      }

      console.log('Authenticating with backend...');

      // ============================================
      // STEP 3: Authenticate with your backend
      // ============================================
      const backendResult = await backendSignIn(idToken);

      if (!backendResult.success) {
        throw new Error(
          backendResult.error || 
          'Backend authentication failed. Your account may not be registered as a tenant.'
        );
      }

      console.log('Backend authentication successful');

      // Success!
      if (onSuccess) {
        onSuccess(firebaseUser);
      }

      // Show success message
      Alert.alert(
        'Welcome!',
        `Signed in as ${firebaseUser.displayName || firebaseUser.email}`,
        [{ text: 'OK', style: 'default' }]
      );

    } catch (error) {
      console.error('Backend authentication error:', error);
      throw error; // Re-throw to be caught by outer try-catch
    }
  };

  // Show loading state while configuring
  if (isConfiguring) {
    return (
      <View style={[styles.button, styles.buttonDisabled, style]}>
        <ActivityIndicator size="small" color="#666" />
        <Text style={styles.buttonTextDisabled}>Loading...</Text>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[
        styles.button,
        (isSigningIn || disabled) && styles.buttonDisabled,
        style,
      ]}
      onPress={handleGoogleSignIn}
      disabled={isSigningIn || disabled}
      activeOpacity={0.7}
    >
      {isSigningIn ? (
        <>
          <ActivityIndicator size="small" color="#666" />
          <Text style={styles.buttonTextDisabled}>Signing in...</Text>
        </>
      ) : (
        <>
          <Ionicons name="logo-google" size={20} color="#DB4437" />
          <Text style={styles.buttonText}>Sign in with Google</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    minHeight: 48,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  buttonDisabled: {
    backgroundColor: '#f5f5f5',
    borderColor: '#e0e0e0',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginLeft: 12,
  },
  buttonTextDisabled: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    marginLeft: 12,
  },
});
