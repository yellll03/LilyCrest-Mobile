import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { pickDocument, pickFromCamera, pickFromLibrary } from '../utils/attachmentPicker';

describe('attachmentPicker', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('picks from library', async () => {
    ImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    ImagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///test.jpg', fileName: 'test.jpg', mimeType: 'image/jpeg' }],
    });
    const file = await pickFromLibrary();
    expect(file?.name).toBe('test.jpg');
    expect(file?.type).toBe('image/jpeg');
  });

  it('picks from camera with permission', async () => {
    ImagePicker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
    ImagePicker.launchCameraAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///photo.png', mimeType: 'image/png' }],
    });
    const file = await pickFromCamera();
    expect(file?.name).toBe('photo.png');
  });

  it('picks document', async () => {
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf' }],
    });
    const file = await pickDocument();
    expect(file?.name).toBe('doc.pdf');
    expect(file?.type).toBe('application/pdf');
  });
});
