/**
 * AlertContext — Global styled alert system
 *
 * Drop-in replacement for React Native's Alert.alert().
 * Wraps the existing StyledModal component so every screen
 * gets a premium animated dialog instead of the native OS alert.
 *
 * Usage:
 *   const { showAlert } = useAlert();
 *   showAlert({
 *     title: 'Success',
 *     message: 'Profile updated.',
 *     type: 'success',                     // 'success' | 'error' | 'warning' | 'info'
 *     buttons: [{ text: 'OK' }],           // optional
 *   });
 */
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import StyledModal from '../components/StyledModal';

const AlertContext = createContext(null);

export function AlertProvider({ children }) {
  const [alertState, setAlertState] = useState({
    visible: false,
    title: '',
    message: '',
    type: undefined,
    icon: undefined,
    iconColor: undefined,
    buttons: undefined,
  });

  // Use a ref so callbacks inside buttons always close the latest alert
  const resolveRef = useRef(null);

  const showAlert = useCallback(({
    title = '',
    message = '',
    type,
    icon,
    iconColor,
    buttons,
  } = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;

      // Wrap button onPress so the modal auto-closes and the promise resolves
      const wrappedButtons = buttons?.map((btn) => ({
        ...btn,
        onPress: () => {
          setAlertState((prev) => ({ ...prev, visible: false }));
          btn.onPress?.();
          resolve(btn.text);
        },
      }));

      setAlertState({
        visible: true,
        title,
        message,
        type,
        icon,
        iconColor,
        buttons: wrappedButtons,
      });
    });
  }, []);

  const handleClose = useCallback(() => {
    setAlertState((prev) => ({ ...prev, visible: false }));
    resolveRef.current?.('__closed__');
  }, []);

  return (
    <AlertContext.Provider value={{ showAlert }}>
      {children}
      <StyledModal
        visible={alertState.visible}
        onClose={handleClose}
        title={alertState.title}
        message={alertState.message}
        type={alertState.type}
        icon={alertState.icon}
        iconColor={alertState.iconColor}
        buttons={alertState.buttons}
      />
    </AlertContext.Provider>
  );
}

/**
 * Hook to access the global styled alert.
 * @returns {{ showAlert: (options: { title, message, type?, icon?, iconColor?, buttons? }) => Promise<string> }}
 */
export function useAlert() {
  const ctx = useContext(AlertContext);
  if (!ctx) {
    // Fallback when used outside provider (shouldn't happen, but safety net)
    return {
      showAlert: ({ title, message }) => {
        const { Alert } = require('react-native');
        Alert.alert(title, message);
        return Promise.resolve('OK');
      },
    };
  }
  return ctx;
}
