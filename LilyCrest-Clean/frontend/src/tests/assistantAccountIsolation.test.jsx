import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import ChatbotScreen from '../../app/(tabs)/chatbot';

let mockUser = { user_id: 'tenant-a' };
jest.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../screens/LilyAssistantScreen', () => {
  const { useState } = require('react');
  const { TextInput } = require('react-native');
  return function AssistantState() {
    const [draft, setDraft] = useState('');
    return <TextInput testID="draft" value={draft} onChangeText={setDraft} />;
  };
});

it('keeps assistant state for the same account and clears it when accounts switch', () => {
  mockUser = { user_id: 'tenant-a' };
  const screen = render(<ChatbotScreen />);
  fireEvent.changeText(screen.getByTestId('draft'), 'private tenant A draft');
  screen.rerender(<ChatbotScreen />);
  expect(screen.getByTestId('draft').props.value).toBe('private tenant A draft');
  mockUser = { user_id: 'tenant-b' };
  screen.rerender(<ChatbotScreen />);
  expect(screen.getByTestId('draft').props.value).toBe('');
});
