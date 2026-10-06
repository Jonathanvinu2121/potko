import { useEffect, useMemo, useState } from 'react';
import { BackHandler, FlatList, Platform, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { Redirect, useIsFocused, useRouter } from 'expo-router';
import { useTheme, fonts, breakpoints } from '../../../src/theme';
import { useMenu } from '../../../src/store/menu';
import { useDraft, totals } from '../../../src/store/draft';
import { useAuth } from '../../../src/store/auth';
import { useLive } from '../../../src/store/live';
import { toast } from '../../../src/store/toast';
import { money, orderLabel, tableName } from '../../../src/lib/format';
import { Screen } from '../../../src/components/Screen';
import { AppHeader } from '../../../src/components/AppHeader';
import { Txt } from '../../../src/components/Txt';
import { Icon } from '../../../src/components/Icon';
import { Chip } from '../../../src/components/Chip';
import { Button } from '../../../src/components/Button';
import { EmptyState } from '../../../src/components/EmptyState';
import { Skeleton } from '../../../src/components/Skeleton';
import { VegMark } from '../../../src/components/VegMark';
import { ItemSheet } from '../../../src/components/ItemSheet';

// W4 Menu: opens on a grid of categories; a category opens a grid of its dishes.
// Search by name or code and the most-ordered shortcuts work from either page.
export default function Menu() {
  const t = useTheme();
  const router = useRouter();
  const draft = useDraft();
  const { categories, items, status, error, load } = useMenu();
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState(null); // null = the grid of categories
  const [sheetItem, setSheetItem] = useState(null);
  const { width } = useWindowDimensions();

  useEffect(() => {
    load();
  }, [load]);

  // Android's back button steps out of a category first, the same as the arrow in the header.
  // Only while the menu is the screen in front, so it never swallows Back on the review page.
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused || categoryId === null) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setCategoryId(null);
      return true;
    });
    return () => sub.remove();
  }, [focused, categoryId]);

  // Dine-in: if the table stops being mine (the lock ran out after 5 idle minutes),
  // say so and go back to Tables. The dishes chosen so far are kept for when it is tapped again.
  const userId = useAuth((s) => s.user?.id);
  const tableId = draft.table?.id;
  const liveTable = useLive((s) => s.tables.find((x) => x.id === tableId));
  const lostTable = !!liveTable && !draft.addTo && liveTable.locked_by !== userId;
  useEffect(() => {
    if (!lostTable) return;
    toast(`${tableName(liveTable.label)} was released. Tap it again to continue.`, { icon: 'lock-open-outline', tone: 'error', duration: 4000 });
    router.dismissTo('/new-order/tables');
  }, [lostTable]); // eslint-disable-line react-hooks/exhaustive-deps

  const popular = useMemo(
    () => [...items].filter((i) => i.available).sort((a, b) => b.order_count - a.order_count).slice(0, 5),
    [items]
  );

  // Name or code, upper or lower case: "imc14" and "chicken" both find Chicken Tikka.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        (categoryId === null || i.category_id === categoryId) &&
        (!q || i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q))
    );
  }, [items, query, categoryId]);

  if (!draft.type) return <Redirect href="/new-order" />;

  const { count, subtotal } = totals(draft.lines);
  const qtyOf = (itemId) => draft.lines.reduce((n, l) => n + (l.itemId === itemId ? l.qty : 0), 0);

  // The menu is a grid of cards: two across on a phone (three in the compact layout), more on a
  // tablet or desktop. A whole card is one big tap target.
  const columns = width >= breakpoints.tablet ? Math.max(3, Math.floor(Math.min(width, 1200) / 220)) : t.d.columns >= 4 ? 3 : 2;

  const searching = query.trim().length > 0;

  // The menu's first page: one card per category, exactly as the manager or admin set them up.
  const categoryCard = ({ item: category }) => {
    const dishes = items.filter((i) => i.category_id === category.id);
    const inOrder = draft.lines.reduce((n, l) => n + (dishes.some((i) => i.id === l.itemId) ? l.qty : 0), 0);
    return (
      <Pressable
        onPress={() => setCategoryId(category.id)}
        accessibilityRole="button"
        accessibilityLabel={`${category.name}, ${dishes.length} dishes`}
        style={({ pressed }) => ({
          flex: 1,
          maxWidth: `${100 / columns}%`,
          minHeight: 120,
          gap: 8,
          padding: 14,
          justifyContent: 'space-between',
          borderRadius: t.radius.card,
          borderWidth: inOrder > 0 ? 2 : t.borderWidth,
          borderColor: inOrder > 0 ? t.c.primary : t.c.border,
          backgroundColor: pressed ? t.c.pressed : t.c.card,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <Chip label={category.prefix} tone="primary" size={12} />
          <Icon name="chevron-right" color="textSecondary" />
        </View>
        <View style={{ gap: 2 }}>
          <Txt size={18} weight={700} numberOfLines={2}>
            {category.name}
          </Txt>
          <Txt size={13} color="textSecondary" tabular>
            {dishes.length} {dishes.length === 1 ? 'dish' : 'dishes'}
            {inOrder > 0 ? ` · ${inOrder} in order` : ''}
          </Txt>
        </View>
      </Pressable>
    );
  };

  const card = ({ item }) => {
    const inOrder = qtyOf(item.id);
    return (
      <Pressable
        onPress={() => setSheetItem(item)}
        disabled={!item.available}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${item.code}, ${money(item.price)}${item.available ? '' : ', unavailable'}${inOrder > 0 ? `, ${inOrder} in order` : ''}`}
        style={({ pressed }) => ({
          flex: 1,
          maxWidth: `${100 / columns}%`,
          minHeight: 132,
          gap: 8,
          padding: 12,
          justifyContent: 'space-between',
          borderRadius: t.radius.card,
          borderWidth: inOrder > 0 ? 2 : t.borderWidth,
          borderColor: inOrder > 0 ? t.c.primary : t.c.border,
          backgroundColor: pressed ? t.c.pressed : t.c.card,
          opacity: item.available ? 1 : 0.5,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        })}
      >
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <VegMark veg={item.veg} />
            <Chip label={item.code} size={11} />
          </View>
          <Txt size={16} weight={600} numberOfLines={2}>
            {item.name}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <Txt size={16} weight={700} tabular style={{ flexShrink: 1 }}>
            {money(item.price)}
          </Txt>
          {item.available ? (
            <View
              style={[
                {
                  minWidth: 40,
                  height: 40,
                  paddingHorizontal: 8,
                  borderRadius: t.radius.control,
                  borderWidth: t.borderWidth,
                  borderColor: inOrder > 0 ? t.c.primary : t.c.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: inOrder > 0 ? t.c.primary : t.c.card,
                },
                t.shadow,
              ]}
            >
              {inOrder > 0 ? (
                <Txt size={16} weight={700} color="onPrimary" tabular>
                  {inOrder}
                </Txt>
              ) : (
                <Icon name="plus" color="primary" />
              )}
            </View>
          ) : (
            <Chip label="Unavailable" tone="error" size={11} />
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <Screen
      scroll={false}
      edges={['top', 'left', 'right']}
      header={
        <AppHeader
          title={draft.addTo?.replacesName ? `Replace ${draft.addTo.replacesName}` : draft.addTo ? `Add to ${orderLabel(draft)}` : orderLabel(draft)}
          back
          onBack={categoryId !== null ? () => setCategoryId(null) : undefined}
        />
      }
      footer={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Txt size={15} weight={600} tabular style={{ flex: 1 }}>
            {count === 0 ? 'No items yet' : `${count} ${count === 1 ? 'item' : 'items'} · ${money(subtotal)}`}
          </Txt>
          <Button title="Review order" disabled={count === 0} onPress={() => router.push('/new-order/preview')} style={{ minWidth: 150 }} />
        </View>
      }
    >
      <View style={{ paddingTop: 12, gap: 10 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: t.d.control,
            paddingLeft: 12,
            borderRadius: t.radius.control,
            borderWidth: t.borderWidth,
            borderColor: query ? t.c.primary : t.c.border,
            backgroundColor: t.c.card,
          }}
        >
          <Icon name="magnify" color="textSecondary" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search name or code (e.g. IMC14)"
            placeholderTextColor={t.c.textSecondary}
            accessibilityLabel="Search the menu"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={{
              flex: 1,
              minHeight: t.d.control,
              paddingHorizontal: 10,
              fontFamily: fonts[400],
              fontSize: t.size(15),
              color: t.c.text,
              ...Platform.select({ web: { outlineStyle: 'none' } }),
            }}
          />
          {query ? (
            <Pressable
              onPress={() => setQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              style={{ width: 44, minHeight: t.d.control, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="close" size={20} color="textSecondary" />
            </Pressable>
          ) : null}
        </View>

        {popular.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', gap: 8 }}>
            <Txt size={11} weight={700} color="textSecondary" style={{ letterSpacing: 1.2 }}>
              MOST ORDERED
            </Txt>
            {popular.map((item) => (
              <Chip key={item.id} label={item.name} onPress={() => setSheetItem(item)} />
            ))}
          </ScrollView>
        ) : null}

        {categoryId !== null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Chip label="All categories" icon="arrow-left" onPress={() => setCategoryId(null)} />
            <Txt size={17} weight={700} numberOfLines={1} style={{ flex: 1 }}>
              {categories.find((c) => c.id === categoryId)?.name}
            </Txt>
          </View>
        ) : !searching ? (
          <Txt size={12} weight={700} color="textSecondary" style={{ letterSpacing: 1.2 }}>
            CATEGORIES
          </Txt>
        ) : null}

        {searching ? (
          <Txt size={12} weight={600} color="textSecondary" tabular>
            {visible.length} {visible.length === 1 ? 'match' : 'matches'}
          </Txt>
        ) : null}
      </View>

      {status === 'loading' ? (
        <View style={{ gap: 16, paddingTop: 16 }}>
          {[0, 1, 2, 3, 4].map((n) => (
            <Skeleton key={n} height={44} />
          ))}
        </View>
      ) : status === 'error' ? (
        <View style={{ flex: 1, justifyContent: 'center', gap: 12 }}>
          <EmptyState icon="wifi-off" title="Couldn’t load the menu" text={error} />
          <Button title="Try again" variant="secondary" onPress={load} style={{ marginBottom: 24 }} />
        </View>
      ) : categoryId === null && !searching ? (
        <FlatList
          data={categories}
          keyExtractor={(c) => `category-${c.id}`}
          renderItem={categoryCard}
          key={`categories-${columns}`}
          numColumns={columns}
          columnWrapperStyle={{ gap: 10 }}
          contentContainerStyle={{ flexGrow: 1, gap: 10, paddingTop: 10, paddingBottom: 12 }}
          ListEmptyComponent={<EmptyState icon="silverware-fork-knife" title="The menu is empty" text="Ask your manager to add categories and dishes." />}
        />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => String(item.id)}
          renderItem={card}
          key={`dishes-${columns}`}
          numColumns={columns}
          columnWrapperStyle={{ gap: 10 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, gap: 10, paddingTop: 10, paddingBottom: 12 }}
          ListEmptyComponent={
            <EmptyState icon="magnify" title="Nothing matches" text={searching ? 'Try a different name or code.' : 'This category has no dishes yet.'} />
          }
        />
      )}

      <ItemSheet item={sheetItem} onClose={() => setSheetItem(null)} onDone={(message) => toast(message)} />
    </Screen>
  );
}
