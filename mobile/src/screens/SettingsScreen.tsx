import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import Button from '../components/Button';
import { useAuth } from '../lib/AuthContext';
import { APP_VERSION } from '../lib/version';

/**
 * Account and app info.
 *
 * Import and export live on the web app only: the browser has a file picker and a downloads
 * folder, where iOS would need a document picker, a share sheet, and a sandbox to get files into
 * and out of.
 */
export default function SettingsScreen() {
  const { user, logout } = useAuth();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <Text style={styles.value}>{user?.email ?? 'Not signed in'}</Text>
        <Text style={styles.hint}>
          This is the account that owns every card. Cards are stored against it, so signing in as
          anyone else shows an empty library rather than this one.
        </Text>
        <Button style={styles.signOutButton} onPress={logout} accessibilityLabel="Sign out">
          <Text style={styles.signOutText}>Sign out</Text>
        </Button>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <Text style={styles.value}>RoloAI v{APP_VERSION}</Text>
        <Text style={styles.hint}>
          Import and export are on the web app, under Settings.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 24 },
  section: { gap: 6 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#888', textTransform: 'uppercase' },
  value: { fontSize: 17 },
  hint: { color: '#666', fontSize: 14, lineHeight: 20 },
  signOutButton: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#c00',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  signOutText: { color: '#c00', fontWeight: '600', fontSize: 16 },
});
