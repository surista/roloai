import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { relabelPhones, relabelEmails, type CardDraft } from '@roloai/shared';
import Button from './Button';
import ImageViewerModal from './ImageViewerModal';
import { useScanWithReview } from '../lib/useScanWithReview';
import { alertForScanFailure } from '../lib/cameraAlerts';

function joinPhones(phones: { number: string }[]): string {
  return phones.map((p) => p.number).join(', ');
}
function joinEmails(emails: { address: string }[]): string {
  return emails.map((e) => e.address).join(', ');
}
function splitToList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export type CardFormFields = Omit<
  CardDraft,
  'imageUrl' | 'imageBackUrl' | 'thumbUrl' | 'source' | 'rawOcrText'
>;

interface Props {
  draft: CardDraft;
  imageUri?: string;
  backImageUri?: string;
  saveLabel: string;
  /**
   * Image URLs are excluded deliberately: the form never sets them, and letting them through as
   * `undefined` would make updateCard's deleteField() mapping wipe the card's photos on a plain
   * text edit.
   */
  onSave: (fields: CardFormFields) => Promise<void>;
  /** When provided, shows Retake/Add Photo controls for an already-saved card. */
  onRetakePhoto?: (side: 'front' | 'back', localUri: string) => Promise<void>;
  extraAction?: { label: string; onPress: () => void; destructive?: boolean };
}

export default function CardForm({
  draft,
  imageUri,
  backImageUri,
  saveLabel,
  onSave,
  onRetakePhoto,
  extraAction,
}: Props) {
  const [firstName, setFirstName] = useState(draft.firstName);
  const [lastName, setLastName] = useState(draft.lastName);
  const [jobTitle, setJobTitle] = useState(draft.jobTitle ?? '');
  const [company, setCompany] = useState(draft.company ?? '');
  const [phonesText, setPhonesText] = useState(joinPhones(draft.phones));
  const [emailsText, setEmailsText] = useState(joinEmails(draft.emails));
  const [website, setWebsite] = useState(draft.website ?? '');
  const [address, setAddress] = useState(draft.address ?? '');
  const [notes, setNotes] = useState(draft.notes ?? '');
  const [tagsText, setTagsText] = useState(draft.tags.join(', '));
  const [saving, setSaving] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [retakingSide, setRetakingSide] = useState<'front' | 'back' | null>(null);
  const { scan, reviewModal } = useScanWithReview();

  const viewerImages = [
    imageUri && { uri: imageUri, label: 'Front' },
    backImageUri && { uri: backImageUri, label: 'Back' },
  ].filter((img): img is { uri: string; label: string } => Boolean(img));

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
    } catch (e) {
      console.error('Retake failed:', e);
      Alert.alert('Retake failed', 'Check your connection and try again.');
    } finally {
      setRetakingSide(null);
    }
  };

  const handleSave = async () => {
    if (!firstName.trim() && !lastName.trim()) {
      Alert.alert('Missing name', 'Enter at least a first or last name.');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        jobTitle: jobTitle.trim() || undefined,
        company: company.trim() || undefined,
        phones: relabelPhones(splitToList(phonesText), draft.phones),
        emails: relabelEmails(splitToList(emailsText), draft.emails),
        website: website.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
        tags: splitToList(tagsText),
      });
    } catch (e) {
      console.error('Card save failed:', e);
      Alert.alert('Save failed', 'Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      // Without these three the bottom of the form is unreachable: iOS puts the keyboard over
      // Notes and Save with no inset to scroll past, and the default keyboardShouldPersistTaps
      // ("never") makes the first tap on Save only dismiss the keyboard, so the button reads as
      // unresponsive.
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      {(imageUri || onRetakePhoto) && (
        <View style={styles.imageBlock}>
          <View style={styles.imageHeader}>
            <Text style={styles.label}>Front</Text>
            {onRetakePhoto && (
              <Button
                onPress={() => handleRetake('front')}
                disabled={retakingSide !== null}
                accessibilityLabel={imageUri ? 'Retake front photo' : 'Add front photo'}
              >
                {retakingSide === 'front' ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Text style={styles.retakeText}>{imageUri ? 'Retake' : 'Add Photo'}</Text>
                )}
              </Button>
            )}
          </View>
          {imageUri ? (
            <Button
              onPress={() => setViewerIndex(0)}
              hitSlop={undefined}
              accessibilityLabel="View front photo full screen"
            >
              <Image source={{ uri: imageUri }} style={styles.preview} />
            </Button>
          ) : (
            <View style={[styles.preview, styles.previewEmpty]}>
              <Text style={styles.previewEmptyText}>No front photo yet</Text>
            </View>
          )}
        </View>
      )}

      {(backImageUri || onRetakePhoto) && (
        <View style={styles.imageBlock}>
          <View style={styles.imageHeader}>
            <Text style={styles.label}>Back</Text>
            {onRetakePhoto && (
              <Button
                onPress={() => handleRetake('back')}
                disabled={retakingSide !== null}
                accessibilityLabel={backImageUri ? 'Retake back photo' : 'Add back photo'}
              >
                {retakingSide === 'back' ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Text style={styles.retakeText}>{backImageUri ? 'Retake' : 'Add Photo'}</Text>
                )}
              </Button>
            )}
          </View>
          {backImageUri ? (
            <Button
              onPress={() => setViewerIndex(imageUri ? 1 : 0)}
              hitSlop={undefined}
              accessibilityLabel="View back photo full screen"
            >
              <Image source={{ uri: backImageUri }} style={styles.preview} />
            </Button>
          ) : (
            <View style={[styles.preview, styles.previewEmpty]}>
              <Text style={styles.previewEmptyText}>No back photo yet</Text>
            </View>
          )}
        </View>
      )}

      <ImageViewerModal
        visible={viewerIndex !== null}
        images={viewerImages}
        initialIndex={viewerIndex ?? 0}
        onClose={() => setViewerIndex(null)}
      />
      {reviewModal}

      <Field label="First name" value={firstName} onChangeText={setFirstName} />
      <Field label="Last name" value={lastName} onChangeText={setLastName} />
      <Field label="Job title" value={jobTitle} onChangeText={setJobTitle} />
      <Field label="Company" value={company} onChangeText={setCompany} />
      <Field
        label="Phone(s)"
        value={phonesText}
        onChangeText={setPhonesText}
        placeholder="comma separated"
        keyboardType="phone-pad"
      />
      <Field
        label="Email(s)"
        value={emailsText}
        onChangeText={setEmailsText}
        placeholder="comma separated"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Field
        label="Website"
        value={website}
        onChangeText={setWebsite}
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Field label="Address" value={address} onChangeText={setAddress} />
      <Field label="Tags" value={tagsText} onChangeText={setTagsText} placeholder="comma separated" />
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline />

      <Button
        style={styles.saveButton}
        onPress={handleSave}
        disabled={saving}
        accessibilityLabel={saveLabel}
        accessibilityState={{ busy: saving }}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>{saveLabel}</Text>}
      </Button>

      {extraAction && (
        <Button style={styles.extraButton} onPress={extraAction.onPress}>
          <Text style={[styles.extraButtonText, extraAction.destructive && styles.destructiveText]}>
            {extraAction.label}
          </Text>
        </Button>
      )}
    </ScrollView>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'url';
  autoCapitalize?: 'none' | 'sentences' | 'words';
  autoCorrect?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={[styles.input, props.multiline && styles.multiline]}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        multiline={props.multiline}
        keyboardType={props.keyboardType}
        autoCapitalize={props.autoCapitalize}
        autoCorrect={props.autoCorrect}
        // Deliberately no textContentType on these: they hold *someone else's* details, and iOS
        // would offer to autofill the signed-in user's own name, company, and address.
        textContentType="none"
        returnKeyType={props.multiline ? 'default' : 'done'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 4, paddingBottom: 48 },
  imageBlock: { marginBottom: 16 },
  imageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  preview: { width: '100%', height: 180, borderRadius: 10, backgroundColor: '#eee' },
  previewEmpty: { alignItems: 'center', justifyContent: 'center' },
  previewEmptyText: { color: '#999', fontSize: 14 },
  retakeText: { color: '#0a7cff', fontWeight: '600', fontSize: 14 },
  field: { marginBottom: 14 },
  label: { fontSize: 13, color: '#666' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 16 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  saveButton: {
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  saveButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  extraButton: { alignItems: 'center', marginTop: 16 },
  extraButtonText: { fontSize: 15, color: '#666' },
  destructiveText: { color: '#c00' },
});
