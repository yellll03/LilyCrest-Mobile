import LilyAssistantScreen from '../../src/screens/LilyAssistantScreen';
import { useAuth } from '../../src/context/AuthContext';

export default function ChatbotScreen() {
  const { user } = useAuth();
  return <LilyAssistantScreen key={user?.user_id || 'guest'} />;
}
