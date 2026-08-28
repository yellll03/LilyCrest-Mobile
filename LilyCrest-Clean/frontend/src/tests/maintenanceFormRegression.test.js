/* global test, __dirname */

import fs from 'fs';
import path from 'path';
import {
  getCreateRequestDescriptionError,
  getMaintenanceAttachmentErrorMessage,
  getMaintenanceAttachmentSelectionError,
  shouldConfirmCreateRequestClose,
} from '../utils/maintenanceForm';

const source = fs.readFileSync(path.resolve(__dirname, '../../app/(tabs)/services.jsx'), 'utf8');

describe('maintenance service-request regression', () => {
  test('blank description has a visible required error and short nonblank text retains minimum-length guidance', () => {
    expect(getCreateRequestDescriptionError('   ')).toBe('Description is required.');
    expect(getCreateRequestDescriptionError('short')).toMatch(/min 10 characters/);
    expect(getCreateRequestDescriptionError('A valid request description.')).toBe('');
    expect(source).toContain('disabled={submitting}');
  });

  test('picker and deferred upload size checks both produce the required 5 MB explanation', () => {
    expect(getMaintenanceAttachmentErrorMessage(new Error('Attachment exceeds 5 MB limit.')))
      .toBe('File must be 5 MB or smaller.');
    expect(source).toContain('getMaintenanceAttachmentSelectionError(file, { maxBytes, supported })');
    expect(source).toContain("showBannerMessage('error', 'File must be 5 MB or smaller.')");
  });

  test('an oversized selection is rejected without poisoning the next valid selection', () => {
    const maxBytes = 5 * 1024 * 1024;
    const oversized = { name: 'too-large.jpg', size: maxBytes + 1 };
    const valid = { name: 'valid.jpg', size: maxBytes - 1 };
    expect(getMaintenanceAttachmentSelectionError(oversized, { maxBytes, supported: true }))
      .toBe('File must be 5 MB or smaller.');
    expect(getMaintenanceAttachmentSelectionError(valid, { maxBytes, supported: true }))
      .toBe('');
  });

  test('empty close exits immediately while dirty/attempted forms require confirmation', () => {
    expect(shouldConfirmCreateRequestClose({ isDirty: false, hasAttemptedSubmit: false })).toBe(false);
    expect(shouldConfirmCreateRequestClose({ isDirty: true })).toBe(true);
    expect(shouldConfirmCreateRequestClose({ hasAttemptedSubmit: true })).toBe(true);
  });

  test('dirty close hides the editor before confirmation; Keep Editing reopens it; Discard resets it', () => {
    expect(source).toMatch(/const confirmCloseModal[\s\S]*?setShowModal\(false\);[\s\S]*?setShowDiscardConfirm\(true\);/);
    expect(source).toMatch(/const keepEditing[\s\S]*?setShowDiscardConfirm\(false\);[\s\S]*?setShowModal\(true\);/);
    expect(source).toMatch(/const discardAndClose[\s\S]*?resetForm\(\);[\s\S]*?setShowModal\(false\);/);
  });

  test('maintenance tenant copy consistently uses Submit Service Request', () => {
    expect(source).toContain('<Text style={styles.submitTitle}>Submit Service Request</Text>');
    expect(source).toContain('<Text style={styles.modalTitle}>Submit Service Request</Text>');
    expect(source).toContain('accessibilityLabel="Submit Service Request"');
    expect(source).not.toMatch(/Submit (?:New )?Inquiry/);
    expect(source).not.toContain('Discard this inquiry?');
  });
});
