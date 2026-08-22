/* global test */
import { Stack, Tabs } from 'expo-router';
import { renderRouter, testRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

const Screen = ({ name }) => <Text>{name}</Text>;
const RootLayout = () => <Stack screenOptions={{ headerShown: false }} />;
const TabLayout = () => (
  <Tabs initialRouteName="home" backBehavior="initialRoute" screenOptions={{ headerShown: false }} />
);

const routes = {
  _layout: {
    default: RootLayout,
    unstable_settings: { initialRouteName: '(tabs)' },
  },
  index: () => <Screen name="Onboarding" />,
  login: () => <Screen name="Login" />,
  'contract-viewer': () => <Screen name="Contract" />,
  '(tabs)/_layout': TabLayout,
  '(tabs)/home': () => <Screen name="Home" />,
  '(tabs)/services': () => <Screen name="Services" />,
};

describe('Expo Router canonical-root integration', () => {
  test('a cold deep link is anchored above Home and Back never reveals Login', () => {
    const result = renderRouter(routes, { initialUrl: '/contract-viewer' });
    const rootState = result.getRouterState();
    const state = rootState.routes.find((route) => route.name === '__root')?.state;

    expect(state.routes.map((route) => route.name)).toEqual(['(tabs)', 'contract-viewer']);
    expect(result.getPathname()).toBe('/contract-viewer');

    testRouter.back();
    expect(result.getByText('Home')).toBeTruthy();
    expect(result.getSegments()).toEqual(['(tabs)']);
    expect(testRouter.canGoBack()).toBe(false);
  });

  test('tab Back returns to Home once and Home delegates Back to the operating system', () => {
    const result = renderRouter(routes, { initialUrl: '/home' });
    testRouter.navigate('/services');
    testRouter.back('/home');

    expect(result.getPathname()).toBe('/home');
    expect(testRouter.canGoBack()).toBe(false);
  });
});
