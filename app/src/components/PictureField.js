import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { pickAndUploadPicture } from '../lib/files';
import { toast } from '../store/toast';
import { Txt } from './Txt';
import { Icon } from './Icon';
import { Picture, Avatar } from './Picture';

// A picture that can be chosen from the phone: a dish, a category, an area, a person, the logo.
// The picture is optional everywhere. onChange receives the saved picture's id, or null to remove it.
//   round  shows it as a person's photo
export function PictureField({ imageId, onChange, icon = 'image-outline', label = 'Add Image (optional)', hint = 'Tap to choose a picture', round, name, size = 72 }) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);

  const choose = async () => {
    setBusy(true);
    try {
      const id = await pickAndUploadPicture({ size: round ? 320 : 512 });
      if (id) onChange(id);
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <Pressable onPress={choose} disabled={busy} accessibilityRole="button" accessibilityLabel={imageId ? 'Change picture' : label} style={({ pressed }) => ({ opacity: busy ? 0.5 : pressed ? 0.7 : 1 })}>
        {round ? <Avatar name={name} imageId={imageId} size={size} /> : <Picture imageId={imageId} icon={icon} size={size} tone="neutral" />}
        <View style={{ position: 'absolute', right: -4, bottom: -4, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: t.c.text, borderWidth: 2, borderColor: t.c.card }}>
          <Icon name="camera-outline" size={14} color="card" />
        </View>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Txt size={14} weight={600}>
          {busy ? 'Saving picture…' : imageId ? 'Change picture' : label}
        </Txt>
        <Txt size={12} color="textSecondary">
          {hint}
        </Txt>
        {imageId && !busy ? (
          <Pressable onPress={() => onChange(null)} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'flex-start', marginTop: 2 }}>
            <Txt size={13} weight={600} color="error">
              Remove
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
