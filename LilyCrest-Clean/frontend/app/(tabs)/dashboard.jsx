import { Redirect } from 'expo-router';

// Redirect legacy 'dashboard' route references to the tabbed home screen
export default function DashboardRedirect() {
  return <Redirect href="/(tabs)/home" />;
}
