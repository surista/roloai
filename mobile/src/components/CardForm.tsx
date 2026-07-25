import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import type { CardDraft } from '@roloai/shared';
import ImageViewerModal from './ImageViewerModal';
import { scanCardEdge } from '../lib/documentScanner';

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

interface Props {
  draft: CardDraft;
  imageUri?: string;
  backImageUri?: string;
  saveLabel: string;
  onSave: (fields: Omit<CardDraft, 'imageUrl' | 'source' | 'rawOcrText'>) => Promise<void>;
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

  const viewerImages = [
    imageUri && { uri: imageUri, label: 'Front' },
    backImageUri && { uri: backImageUri, label: 'Back' },
  ].filter((img): img is { uri: string; label: string } => Boolean(img));

  const handleRetake = async (side: 'front' | 'back') => {
    if (!onRetakePhoto || retakingSide) return;
    setRetakingSide(side);
    try {
      const uri = await scanCardEdge();
      if (!uri) return;
      await onRetakePhoto(side, uri);
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
        phones: splitToList(phonesText).map((number) => ({ label: 'work', number })),
        emails: splitToList(emailsText).map((address) => ({ label: 'work', address })),
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
    <ScrollView contentContainerStyle={styles.container}>
      {(imageUri || onRetakePhoto) && (
        <View style={styles.imageBlock}>
          <View style={styles.imageHeader}>
            <Text style={styles.label}>Front</Text>
            {onRetakePhoto && (
              <Pressable onPress={() => handleRetake('front')} disabled={retakingSide !== null}>
                {retakingSide === 'front' ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Text style={styles.retakeText}>{imageUri ? 'Retake' : 'Add Photo'}</Text>
                )}
              </Pressable>
            )}
          </View>
          {imageUri ? (
            <Pressable onPress={() => setViewerIndex(0)}>
              <Image source={{ uri: imageUri }} style={styles.preview} />
            </Pressable>
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
              <Pressable onPress={() => handleRetake('back')} disabled={retakingSide !== null}>
                {retakingSide === 'back' ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Text style={styles.retakeText}>{backImageUri ? 'Retake' : 'Add Photo'}</Text>
                )}
              </Pressable>
            )}
          </View>
          {backImageUri ? (
            <Pressable onPress={() => setViewerIndex(imageUri ? 1 : 0)}>
              <Image source={{ uri: backImageUri }} style={styles.preview} />
            </Pressable>
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
      />
      <Field label="Website" value={website} onChangeText={setWebsite} autoCapitalize="none" />
      <Field label="Address" value={address} onChangeText={setAddress} />
      <Field label="Tags" value={tagsText} onChangeText={setTagsText} placeholder="comma separated" />
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline />

      <Pressable style={styles.saveButton} onPress={handleSave} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>{saveLabel}</Text>}
      </Pressable>

      {extraAction && (
        <Pressable style={styles.extraButton} onPress={extraAction.onPress}>
          <Text style={[styles.extraButtonText, extraAction.destructive && styles.destructiveText]}>
            {extraAction.label}
          </Text>
        </Pressable>
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
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words';
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
