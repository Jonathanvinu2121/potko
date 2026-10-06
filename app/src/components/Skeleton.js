import { useEffect, useRef } from 'react';
import { Animated, Platform } from 'react-native';
import { useTheme } from '../theme';

// A grey block that gently pulses where content is still loading.
export function Skeleton({ height = 16, width = '100%', radius = 8, style }) {
  const t = useTheme();
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const fade = (toValue) => Animated.timing(opacity, { toValue, duration: 600, useNativeDriver: Platform.OS !== 'web' });
    const loop = Animated.loop(Animated.sequence([fade(1), fade(0.5)]));
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={[{ height, width, borderRadius: radius, backgroundColor: t.c.border, opacity }, style]} />;
}
