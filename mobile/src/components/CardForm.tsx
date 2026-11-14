import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Image,
  StyleSheet,
  ActivityIndicator,
  ActionSheetIOS,
  Alert,
} from 'react-native';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SymbolView } from 'expo-symbols';
import type { CardDraft, CardEmail, CardPhone } from '@roloai/shared';
import Button from './Button';
import ImageViewerModal from './ImageViewerModal';
import { useScanWithReview } from '../lib/useScanWithReview';
import { alertForScanFailure } from '../lib/cameraAlerts';
import { SaveAborted } from '../lib/duplicateCheck';
import { haptics } from '../lib/haptics';
import { colors, type } from '../theme';

/** Roughly a business card on its side (91×55mm), used until the real dimensions load. */
const CARD_ASPECT = 91 / 55;

/** The labels Contacts offers, in its order. A label read off a card ("direct") is kept as-is. */
const PHONE_LABELS = ['mobile', 'work', 'home', 'main', 'work fax', 'other'];
const EMAIL_LABELS = ['work', 'home', 'other'];

/**
 * The photo's own width/height, so the preview box can take the shape of the card instead of
 * cropping it to fit a fixed one. `Image.getSize` reads the header only.
 */
function useImageAspect(uri?: string): number {
  const [aspect, setAspect] = useState(CARD_ASPECT);
  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    setAspect(CARD_ASPECT);
    Image.getSize(
      uri,
      (width, height) => {
        if (!cancelled && height > 0) setAspect(width / height);
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);
  return aspect;
}

export type CardFormFields = Omit<
  CardDraft,
  | 'imageUrl'
  | 'imageBackUrl'
  | 'thumbUrl'
  | 'source'
  | 'rawOcrText'
  | 'metPlace'
  | 'metLocation'
  | 'followUpAt'
>;

interface FooterAction {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

interface Props {
  draft: CardDraft;
  imageUri?: string;
  backImageUri?: string;
  /** The header button's label: "Save" for a new card, "Done" when editing one. */
  saveLabel: string;
  /**
   * Persists the fields. May throw SaveAborted to stop quietly. Image URLs are excluded
   * deliberately: the form never sets them, and letting them through as `undefined` would make
   * updateCard's deleteField() mapping wipe the card's photos on a plain text edit.
   */
  onSave: (fields: CardFormFields) => Promise<void>;
  /**
   * Called once the save has landed and the unsaved-changes guard is off. Navigation belongs
   * here, not in onSave: leaving from inside onSave would be caught by the guard and shown as
   * "Discard changes?" for changes that were in fact just saved.
   */
  onSaved: () => void;
  /**
   * A new card is unsaved by definition, so leaving it always asks. An existing card only asks
   * when something was changed.
   */
  isNew?: boolean;
  /** Lifts the unsaved-changes guard, for a parent leaving on purpose (e.g. the scan was queued). */
  allowLeave?: boolean;
  /** Presented as a sheet: show Cancel on the left, as every iOS edit sheet does. */
  showCancel?: boolean;
  /** When provided, shows Retake/Add Photo controls for an already-saved card. */
  onRetakePhoto?: (side: 'front' | 'back', localUri: string) => Promise<void>;
  footerActions?: FooterAction[];
  /**
   * The details are still being read off the photo. Shows the card with a banner, and holds the
   * fields and Save until the draft arrives — the parent then remounts the form with it, which
   * would throw away anything typed in the meantime.
   */
  reading?: boolean;
  /** Rendered above everything else in the form (e.g. pairing banners). */
  header?: React.ReactNode;
}

interface FormState {
  firstName: string;
  lastName: string;
  jobTitle: string;
  company: string;
  phones: CardPhone[];
  emails: CardEmail[];
  website: string;
  address: string;
  event: string;
  tags: string;
  notes: string;
}

function initialState(draft: CardDraft): FormState {
  return {
    firstName: draft.firstName,
    lastName: draft.lastName,
    jobTitle: draft.jobTitle ?? '',
    company: draft.company ?? '',
    phones: draft.phones.map((p) => ({ ...p })),
    emails: draft.emails.map((e) => ({ ...e })),
    website: draft.website ?? '',
    address: draft.address ?? '',
    event: draft.event ?? '',
    tags: draft.tags.join(', '),
    notes: draft.notes ?? '',
  };
}

function toFields(s: FormState): CardFormFields {
  return {
    firstName: s.firstName.trim(),
    lastName: s.lastName.trim(),
    jobTitle: s.jobTitle.trim() || undefined,
    company: s.company.trim() || undefined,
    phones: s.phones
      .map((p) => ({ label: p.label || 'work', number: p.number.trim() }))
      .filter((p) => p.number),
    emails: s.emails
      .map((e) => ({ label: e.label || 'work', address: e.address.trim() }))
      .filter((e) => e.address),
    website: s.website.trim() || undefined,
    address: s.address.trim() || undefined,
    event: s.event.trim() || undefined,
    notes: s.notes.trim() || undefined,
    tags: s.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  };
}

function pickLabel(options: string[], current: string): Promise<string | undefined> {
  const all = options.includes(current) || !current ? options : [current, ...options];
  return new Promise((resolve) => {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Label', options: [...all, 'Cancel'], cancelButtonIndex: all.length },
      (i) => resolve(i < all.length ? all[i] : undefined)
    );
  });
}

export default function CardForm({
  draft,
  imageUri,
  backImageUri,
  saveLabel,
  onSave,
  onSaved,
  isNew = false,
  allowLeave = false,
  showCancel = false,
  onRetakePhoto,
  footerActions,
  reading = false,
  header,
}: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const initial = useMemo(() => initialState(draft), [draft]);
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [retakingSide, setRetakingSide] = useState<'front' | 'back' | null>(null);
  const { scan, reviewModal } = useScanWithReview();
  const frontAspect = useImageAspect(imageUri);
  const backAspect = useImageAspect(backImageUri);

  const dirty = useMemo(
    () => JSON.stringify(toFields(form)) !== JSON.stringify(toFields(initial)),
    [form, initial]
  );
  const hasName = Boolean(form.firstName.trim() || form.lastName.trim());
  const canSave = !reading && !saving && hasName && (isNew || dirty);

  // Unsaved work must never vanish on a back swipe. A new card is unsaved by definition.
  usePreventRemove(!saved && !allowLeave && (isNew || dirty), ({ data }) => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: isNew ? 'Discard this card?' : 'Discard your changes?',
        message: isNew ? 'It has not been saved.' : undefined,
        options: [isNew ? 'Discard Card' : 'Discard Changes', 'Keep Editing'],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (i) => {
        if (i === 0) navigation.dispatch(data.action);
      }
    );
  });

  useEffect(() => {
    if (saved) onSaved();
    // Fires once, after the guard has re-rendered off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    if (!canSave) {
      if (!hasName) Alert.alert('Name Required', 'Enter at least a first or last name.');
      return;
    }
    setSaving(true);
    try {
      await onSave(toFields(form));
      haptics.success();
      setSaved(true);
    } catch (e) {
      // The user backed out of a prompt (e.g. the duplicate warning). Nothing failed.
      if (e instanceof SaveAborted) return;
      console.error('Card save failed:', e);
      haptics.error();
      Alert.alert('Couldn’t Save', 'Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  // Save lives in the navigation bar, where every iOS edit sheet puts it.
  useLayoutEffect(() => {
    navigation.setOptions({
      unstable_headerRightItems: () => [
        saving
          ? {
              type: 'custom',
              element: <ActivityIndicator />,
              hidesSharedBackground: true,
            }
          : {
              type: 'button',
              label: saveLabel,
              variant: 'done',
              // Disabled until there is a name and (for an existing card) a change, as Contacts
              // does — a Save that does nothing gives no feedback at all.
              disabled: !canSave,
              onPress: handleSave,
            },
      ],
      unstable_headerLeftItems: showCancel
        ? () => [{ type: 'button', label: 'Cancel', onPress: () => navigation.goBack() }]
        : undefined,
    });
    // handleSave closes over the form, so the button is rebuilt whenever the form changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, form, saving, canSave, saveLabel, showCancel]);

  const handleRetake = async (side: 'front' | 'back') => {
    if (!onRetakePhoto || retakingSide) return;
    setRetakingSide(side);
    try {
      const result = await scan(side === 'front' ? 'Front of card' : 'Back of card');
      if (result.status !== 'ok') {
        alertForScanFailure(result);
        return;
      }
      await onRetakePhoto(side, result.uri);
      haptics.success();
    } catch (e) {
      console.error('Retake failed:', e);
      Alert.alert('Couldn’t Replace Photo', 'Check your connection and try again.');
    } finally {
      setRetakingSide(null);
    }
  };

  const viewerImages = [
    imageUri && { uri: imageUri, label: 'Front' },
    backImageUri && { uri: backImageUri, label: 'Back' },
  ].filter((img): img is { uri: string; label: string } => Boolean(img));

  // Return-key chaining: Next moves through the single-line fields in order.
  const refs = useRef<(TextInput | null)[]>([]);
  let order = 0;
  const chain = () => {
    const index = order++;
    return {
      ref: (r: TextInput | null) => {
        refs.current[index] = r;
      },
      onSubmitEditing: () => refs.current[index + 1]?.focus(),
      submitBehavior: 'submit' as const,
      returnKeyType: 'next' as const,
    };
  };

  const editable = !reading;

  const photo = (side: 'front' | 'back') => {
    const uri = side === 'front' ? imageUri : backImageUri;
    if (!uri && !onRetakePhoto) return null;
    const aspect = side === 'front' ? frontAspect : backAspect;
    const label = side === 'front' ? 'Front' : 'Back';
    return (
      <View style={styles.imageBlock}>
        <View style={styles.imageHeader}>
          <Text style={styles.sectionHeader}>{label}</Text>
          {onRetakePhoto && (
            <Button
              onPress={() => handleRetake(side)}
              disabled={retakingSide !== null}
              accessibilityLabel={uri ? `Retake ${side} photo` : `Add ${side} photo`}
            >
              {retakingSide === side ? (
                <ActivityIndicator size="small" />
              ) : (
                <Text style={styles.link}>{uri ? 'Retake' : 'Add Photo'}</Text>
              )}
            </Button>
          )}
        </View>
        {uri ? (
          <Button
            onPress={() => setViewerIndex(side === 'back' && imageUri ? 1 : 0)}
            hitSlop={undefined}
            accessibilityRole="imagebutton"
            accessibilityLabel={`${label} of card`}
            accessibilityHint="Opens the photo full screen"
          >
            <Image source={{ uri }} style={[styles.preview, { aspectRatio: aspect }]} resizeMode="contain" />
          </Button>
        ) : (
          <View style={[styles.preview, styles.previewEmpty]}>
            <Text style={styles.footnote}>No {side} photo yet</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      {header}

      {reading && (
        <View style={styles.readingBanner} accessibilityRole="progressbar" accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" />
          <Text style={styles.readingText}>Reading card… this can take up to a minute.</Text>
        </View>
      )}

      {photo('front')}
      {photo('back')}

      <ImageViewerModal
        visible={viewerIndex !== null}
        images={viewerImages}
        initialIndex={viewerIndex ?? 0}
        onClose={() => setViewerIndex(null)}
      />
      {reviewModal}

      <Section>
        <Row label="First" first>
          <Input {...chain()} editable={editable} value={form.firstName} onChangeText={(v) => set('firstName', v)} placeholder="First name" autoCapitalize="words" />
        </Row>
        <Row label="Last">
          <Input {...chain()} editable={editable} value={form.lastName} onChangeText={(v) => set('lastName', v)} placeholder="Last name" autoCapitalize="words" />
        </Row>
        <Row label="Title">
          <Input {...chain()} editable={editable} value={form.jobTitle} onChangeText={(v) => set('jobTitle', v)} placeholder="Job title" autoCapitalize="words" />
        </Row>
        <Row label="Company">
          <Input {...chain()} editable={editable} value={form.company} onChangeText={(v) => set('company', v)} placeholder="Company" autoCapitalize="words" />
        </Row>
      </Section>

      <MultiSection
        items={form.phones}
        editable={editable}
        addLabel="add phone"
        labels={PHONE_LABELS}
        valueOf={(p) => p.number}
        make={(label, value) => ({ label, number: value })}
        onChange={(phones) => set('phones', phones)}
        inputProps={{ keyboardType: 'phone-pad', placeholder: 'Phone' }}
      />

      <MultiSection
        items={form.emails}
        editable={editable}
        addLabel="add email"
        labels={EMAIL_LABELS}
        valueOf={(e) => e.address}
        make={(label, value) => ({ label, address: value })}
        onChange={(emails) => set('emails', emails)}
        inputProps={{ keyboardType: 'email-address', autoCapitalize: 'none', autoCorrect: false, placeholder: 'Email' }}
      />

      <Section>
        <Row label="Website" first>
          <Input {...chain()} editable={editable} value={form.website} onChangeText={(v) => set('website', v)} placeholder="Website" keyboardType="url" autoCapitalize="none" autoCorrect={false} />
        </Row>
        <Row label="Address">
          <Input editable={editable} value={form.address} onChangeText={(v) => set('address', v)} placeholder="Address" multiline />
        </Row>
      </Section>

      <Section>
        <Row label="Met at" first>
          <Input {...chain()} editable={editable} value={form.event} onChangeText={(v) => set('event', v)} placeholder="Event or occasion" autoCapitalize="sentences" />
        </Row>
        <Row label="Tags">
          <Input {...chain()} editable={editable} value={form.tags} onChangeText={(v) => set('tags', v)} placeholder="Comma separated" autoCapitalize="none" />
        </Row>
        <Row label="Notes">
          <Input editable={editable} value={form.notes} onChangeText={(v) => set('notes', v)} placeholder="Notes" multiline />
        </Row>
      </Section>

      {footerActions?.map((action) => (
        <Section key={action.label}>
          <Button
            style={styles.actionRow}
            pressedStyle={styles.rowPressed}
            hitSlop={undefined}
            onPress={action.onPress}
          >
            <Text style={[styles.actionText, action.destructive && styles.destructive]}>{action.label}</Text>
          </Button>
        </Section>
      ))}
    </ScrollView>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <View style={styles.section}>{children}</View>;
}

function Row({ label, first, children }: { label: string; first?: boolean; children: React.ReactNode }) {
  return (
    <View style={[styles.row, !first && styles.rowSeparator]}>
      <Text style={styles.rowLabel} accessibilityElementsHidden importantForAccessibility="no">
        {label}
      </Text>
      <View style={styles.rowValue}>{children}</View>
    </View>
  );
}

const Input = React.forwardRef<TextInput, React.ComponentProps<typeof TextInput>>(function Input(props, ref) {
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.placeholder}
      // Deliberately no textContentType: these hold *someone else's* details, and iOS would
      // offer to autofill the signed-in user's own name, company, and address.
      textContentType="none"
      accessibilityLabel={props.placeholder}
      {...props}
      style={[styles.input, props.multiline && styles.multiline, props.style]}
    />
  );
});

/**
 * Contacts-style rows for a repeated value: a label button, the value, a delete control, and an
 * "add" row. Replaces the old comma-separated field, which the phone keypad could not even type a
 * comma into.
 */
function MultiSection<T extends { label: string }>(props: {
  items: T[];
  editable: boolean;
  addLabel: string;
  labels: string[];
  valueOf: (item: T) => string;
  make: (label: string, value: string) => T;
  onChange: (items: T[]) => void;
  inputProps: React.ComponentProps<typeof TextInput>;
}) {
  const { items, editable, labels, valueOf, make, onChange } = props;
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const inputs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    if (focusIndex !== null) {
      inputs.current[focusIndex]?.focus();
      setFocusIndex(null);
    }
  }, [focusIndex]);

  const update = (i: number, next: T) => onChange(items.map((item, j) => (j === i ? next : item)));

  return (
    <View style={styles.section}>
      {items.map((item, i) => (
        <View key={i} style={[styles.row, i > 0 && styles.rowSeparator]}>
          <Button
            disabled={!editable}
            onPress={() => onChange(items.filter((_, j) => j !== i))}
            accessibilityLabel={`Delete ${item.label} ${valueOf(item)}`}
          >
            <SymbolView name="minus.circle.fill" size={22} tintColor={colors.destructive} />
          </Button>
          <Button
            style={styles.labelButton}
            disabled={!editable}
            onPress={async () => {
              const label = await pickLabel(labels, item.label);
              if (label) update(i, make(label, valueOf(item)));
            }}
            accessibilityLabel={`Label: ${item.label}`}
            accessibilityHint="Changes the label"
          >
            <Text style={styles.labelButtonText} numberOfLines={1}>
              {item.label || 'other'}
            </Text>
            <SymbolView name="chevron.right" size={11} tintColor={colors.tertiaryLabel} />
          </Button>
          <View style={styles.rowValue}>
            <Input
              ref={(r) => {
                inputs.current[i] = r;
              }}
              {...props.inputProps}
              editable={editable}
              value={valueOf(item)}
              onChangeText={(v) => update(i, make(item.label, v))}
              returnKeyType="done"
            />
          </View>
        </View>
      ))}
      <Button
        style={[styles.row, items.length > 0 && styles.rowSeparator]}
        pressedStyle={styles.rowPressed}
        hitSlop={undefined}
        disabled={!editable}
        onPress={() => {
          onChange([...items, make(labels[0], '')]);
          setFocusIndex(items.length);
        }}
      >
        <SymbolView name="plus.circle.fill" size={22} tintColor={colors.success} />
        <Text style={styles.addText}>{props.addLabel}</Text>
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.groupedBackground },
  container: { padding: 16, gap: 20, paddingBottom: 48 },
  readingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.cell,
  },
  readingText: { ...type.subheadline, color: colors.secondaryLabel, flexShrink: 1 },
  imageBlock: { gap: 6 },
  imageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  sectionHeader: { ...type.footnote, color: colors.secondaryLabel, textTransform: 'uppercase' },
  link: { ...type.subheadline, color: colors.tint },
  // Height comes from the photo's own aspect ratio, capped so a portrait shot can't push the
  // form off the screen.
  preview: { width: '100%', maxHeight: 280, borderRadius: 10, backgroundColor: colors.tertiaryFill },
  previewEmpty: { height: 160, alignItems: 'center', justifyContent: 'center' },
  footnote: { ...type.footnote, color: colors.secondaryLabel },
  section: { backgroundColor: colors.cell, borderRadius: 10, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingLeft: 16,
    paddingRight: 12,
    gap: 10,
  },
  rowSeparator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowPressed: { backgroundColor: colors.fill },
  rowLabel: { ...type.body, color: colors.label, width: 82 },
  rowValue: { flex: 1 },
  input: { ...type.body, color: colors.label, paddingVertical: 11 },
  multiline: { minHeight: 66, textAlignVertical: 'top', paddingTop: 11 },
  labelButton: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 86 },
  labelButtonText: { ...type.subheadline, color: colors.tint, flexShrink: 1 },
  addText: { ...type.body, color: colors.label },
  actionRow: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  actionText: { ...type.body, color: colors.tint },
  destructive: { color: colors.destructive },
});
