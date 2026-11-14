import React, { useCallback, useEffect } from 'react';
import { View, ActivityIndicator, useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  NavigationContainer,
  DarkTheme,
  DefaultTheme,
  createNavigationContainerRef,
  type LinkingOptions,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { useQuickActionCallback } from 'expo-quick-actions/hooks';
import { AuthProvider, useAuth } from './src/lib/AuthContext';
import { CardsProvider, useCards } from './src/lib/CardsContext';
import { useFollowUpSync } from './src/lib/reminders';
import { cardIdFromResponse } from './src/lib/reminders';
import { useQueueAutoRead } from './src/lib/queueReader';
import { useSpotlightIndex } from './src/lib/spotlight';
import { useDevRoute } from './src/lib/devRoute';
import type { RootStackParamList } from './src/navigation/types';
import LoginScreen from './src/screens/LoginScreen';
import CardListScreen from './src/screens/CardListScreen';
import ScanScreen from './src/screens/ScanScreen';
import ReviewEditScreen from './src/screens/ReviewEditScreen';
import CardDetailScreen from './src/screens/CardDetailScreen';
import EditCardScreen from './src/screens/EditCardScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import MyCardScreen from './src/screens/MyCardScreen';
import { colors } from './src/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * roloai://scan opens the scanner (Shortcuts' "Open URL", the Home Screen quick action) and
 * roloai://card/<id> opens a card (Spotlight results, reminders).
 */
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['roloai://'],
  config: {
    // A cold launch from a link still has the list underneath, so Close/Back have somewhere to go.
    initialRouteName: 'CardList',
    screens: {
      CardList: '',
      Scan: 'scan',
      CardDetail: 'card/:cardId',
      MyCard: 'mycard',
      EditCard: 'card/:cardId/edit',
      Settings: 'settings',
    },
  },
};

/**
 * Navigates once the container is ready. A cold launch from a reminder, a quick action or a
 * Spotlight result asks to navigate before the first screen has mounted.
 */
function navigateWhenReady(go: () => void, attempts = 40): void {
  if (navigationRef.isReady()) go();
  else if (attempts > 0) setTimeout(() => navigateWhenReady(go, attempts - 1), 100);
}

const openCard = (cardId: string) =>
  navigateWhenReady(() => navigationRef.navigate('CardDetail', { cardId }));

/** Things that open a screen from outside the app: reminders, quick actions, Spotlight. */
function useExternalEntryPoints() {
  const lastResponse = Notifications.useLastNotificationResponse();

  useEffect(() => {
    const cardId = cardIdFromResponse(lastResponse);
    if (!cardId) return;
    // Handled once: the hook keeps returning the same response, so after a sign-out/in it would
    // reopen this card.
    Notifications.clearLastNotificationResponse();
    openCard(cardId);
  }, [lastResponse]);

  // Stable: the hook re-runs the callback with the launch action whenever the callback changes,
  // and this component re-renders on every library snapshot — an inline function reopened the
  // scanner after each save on a launch from the Home Screen.
  useQuickActionCallback(
    useCallback((action: { id: string }) => {
      if (action.id === 'scan') navigateWhenReady(() => navigationRef.navigate('Scan'));
      if (action.id === 'mycard') navigateWhenReady(() => navigationRef.navigate('MyCard'));
    }, [])
  );

  useSpotlightIndex(openCard);
}

function SignedInApp() {
  const scheme = useColorScheme();
  useExternalEntryPoints();
  useQueueAutoRead();
  const { all, loaded } = useCards();
  useFollowUpSync(all, loaded);
  useDevRoute(navigationRef);

  return (
    <NavigationContainer
      ref={navigationRef}
      linking={linking}
      theme={scheme === 'dark' ? DarkTheme : DefaultTheme}
    >
      <Stack.Navigator screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
        <Stack.Screen
          name="CardList"
          component={CardListScreen}
          options={{ title: 'Cards', headerLargeTitle: true, headerTransparent: false }}
        />
        {/* Capture is a separate task, so it is presented, not pushed (HIG: Modality). */}
        <Stack.Screen
          name="Scan"
          component={ScanScreen}
          options={{ headerShown: false, presentation: 'fullScreenModal' }}
        />
        <Stack.Screen name="ReviewEdit" component={ReviewEditScreen} options={{ title: 'New Card' }} />
        <Stack.Screen
          name="CardDetail"
          component={CardDetailScreen}
          options={{ title: '', headerShadowVisible: false }}
        />
        <Stack.Screen
          name="EditCard"
          component={EditCardScreen}
          options={{ title: 'Edit Card', presentation: 'modal' }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: 'Settings' }}
        />
        <Stack.Screen name="MyCard" component={MyCardScreen} options={{ title: 'My Card' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function AppNavigator() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!user) return <LoginScreen />;

  return (
    <CardsProvider>
      <SignedInApp />
    </CardsProvider>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* LoginScreen renders outside NavigationContainer, so the inset provider has to be at the root. */}
      <SafeAreaProvider>
        <AuthProvider>
          <AppNavigator />
          <StatusBar style="auto" />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
