import { Redirect } from 'expo-router';

// Redirect legacy 'home' route references to the tabbed home screen
export default function HomeRedirect() {
  return <Redirect href="/(tabs)/home" />;
}
