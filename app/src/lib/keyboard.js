// Helpers for the on-screen keyboard. The space the keyboard takes is given back by a
// KeyboardAvoidingView (see Screen and BottomSheet); these keep the rest in step with it.
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, TextInput } from 'react-native';

const SHOW = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const HIDE = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

// Where the top edge of the keyboard is on screen, or null while it is hidden.
export function useKeyboardTop() {
  const [top, setTop] = useState(null);
  useEffect(() => {
    const show = Keyboard.addListener(SHOW, (e) => setTop(e.endCoordinates?.screenY ?? null));
    const hide = Keyboard.addListener(HIDE, () => setTop(null));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return top;
}

// Keeps the field being typed in on screen. Spread the result on the ScrollView that holds the
// fields: when the keyboard comes up and the list gets shorter, it scrolls the focused field
// back into view. A field in some other scroll view (a sheet above this page) is left alone.
export function useKeepInputVisible(margin = 16) {
  const ref = useRef(null);
  const offset = useRef(0);
  const height = useRef(0);
  const keyboardUp = useRef(false);

  const reveal = () => {
    const input = TextInput.State.currentlyFocusedInput?.();
    const inner = ref.current?.getInnerViewRef?.();
    if (!input?.measureLayout || !inner) return;
    input.measureLayout(
      inner,
      (x, y, w, h) => {
        const top = offset.current;
        const bottom = top + height.current;
        if (y + h + margin > bottom) ref.current?.scrollTo({ y: y + h + margin - height.current, animated: true });
        else if (y - margin < top) ref.current?.scrollTo({ y: Math.max(0, y - margin), animated: true });
      },
      () => {} // not inside this scroll view
    );
  };

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => {
      keyboardUp.current = true;
      setTimeout(reveal, 150); // after the layout has moved up
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardUp.current = false;
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    ref,
    scrollEventThrottle: 32,
    onScroll: (e) => {
      offset.current = e.nativeEvent.contentOffset.y;
    },
    onLayout: (e) => {
      height.current = e.nativeEvent.layout.height;
      if (keyboardUp.current) setTimeout(reveal, 50);
    },
  };
}
