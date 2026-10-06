import { useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { useTheme, fonts } from '../theme';
import { Txt } from './Txt';
import { Icon } from './Icon';

// A labelled input. `secure` hides the text and adds a show/hide eye.
export function TextField({ label, required, secure, error, style, ...inputProps }) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);

  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? (
        <Txt size={13} weight={600}>
          {label}
          {required ? ' *' : ''}
        </Txt>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: t.d.control,
          borderRadius: t.radius.control,
          borderWidth: t.borderWidth,
          borderColor: error ? t.c.error : focused ? t.c.primary : t.c.border,
          backgroundColor: t.c.card,
        }}
      >
        <TextInput
          placeholderTextColor={t.c.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          {...inputProps}
          accessibilityLabel={label}
          secureTextEntry={secure && hidden}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1,
            minHeight: t.d.control,
            paddingHorizontal: 14,
            fontFamily: fonts[400],
            fontSize: t.size(15),
            color: t.c.text,
            ...Platform.select({ web: { outlineStyle: 'none' } }), // the border already shows focus
          }}
        />
        {secure ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            style={{ width: 48, minHeight: t.d.control, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name={hidden ? 'eye-outline' : 'eye-off-outline'} color="textSecondary" />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
