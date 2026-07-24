import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthProvider, useAuth } from './src/lib/AuthContext';
import type { RootStackParamList } from './src/navigation/types';
import LoginScreen from './src/screens/LoginScreen';
import CardListScreen from './src/screens/CardListScreen';
import ScanScreen from './src/screens/ScanScreen';
import ReviewEditScreen from './src/screens/ReviewEditScreen';
import CardDetailScreen from './src/screens/CardDetailScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

function AppNavigator() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="CardList" component={CardListScreen} options={{ title: 'RoloAI' }} />
        <Stack.Screen name="Scan" component={ScanScreen} options={{ title: 'Scan Card', headerShown: false }} />
        <Stack.Screen name="ReviewEdit" component={ReviewEditScreen} options={{ title: 'Review Card' }} />
        <Stack.Screen name="CardDetail" component={CardDetailScreen} options={{ title: 'Card Details' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppNavigator />
      <StatusBar style="auto" />
    </AuthProvider>
  );
}
