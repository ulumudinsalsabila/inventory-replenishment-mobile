import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '../auth/auth-provider';

export default function IndexRoute() {
  const { loading, accessToken } = useAuth();
  if (loading) {
    return <View style={styles.container}><ActivityIndicator color="#087f5b" size="large" /></View>;
  }
  return <Redirect href={accessToken ? '/(app)/(tabs)' : '/login'} />;
}

const styles = StyleSheet.create({ container: { flex: 1, alignItems: 'center', justifyContent: 'center' } });
