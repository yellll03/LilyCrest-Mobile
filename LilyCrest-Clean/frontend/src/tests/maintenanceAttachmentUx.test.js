/* global __dirname, test */
const fs = require('fs');
const path = require('path');

const screen = fs.readFileSync(
  path.resolve(__dirname, '../../app/(tabs)/services.jsx'),
  'utf8',
);

describe('maintenance create-request attachment UX', () => {
  test('uses the shared compact attachment source sheet instead of three full-size picker buttons', () => {
    expect(screen).toContain('visible={showCreateAttachMenu}');
    expect(screen).toContain('onPress={() => setShowCreateAttachMenu(true)}');
    expect(screen).toContain('onTakePhoto={() => handleAttach(pickFromCamera)}');
    expect(screen).toContain('onChoosePhoto={() => handleAttach(pickFromLibrary)}');
    expect(screen).toContain('onChooseDocument={() => handleAttach(pickDocument)}');
    expect(screen).not.toContain('styles.uploadPanel');
    expect(screen).not.toContain('Choose from Gallery');
  });

  test('shows the true file support, per-file limit, and attachment count', () => {
    expect(screen).toContain('Photos, PDF, Word, TXT, or CSV - max 5 MB each');
    expect(screen).toContain('{attachments.length}/{MAX_MAINTENANCE_ATTACHMENTS}');
    expect(screen).not.toContain('Accepted: JPG, PNG');
    expect(screen).not.toContain('photos only.');
  });

  test('offers a visible, accessible remove action for every selected file', () => {
    expect(screen).toContain('onPress={() => removeAttachment(index)}');
    expect(screen).toContain('accessibilityLabel={`Remove ${getAttachmentDisplayName(file)}`}');
    expect(screen).not.toContain('onLongPress={() => removeAttachment');
  });
});
