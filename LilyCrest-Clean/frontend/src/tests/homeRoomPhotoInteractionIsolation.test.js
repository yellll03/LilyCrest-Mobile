/* global test, __dirname */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

// Proves the Home screen's room-photo tap target and room-info tap target
// stay on two separate TouchableOpacitys (regression guard: they used to be
// one Touchable that only opened a text info modal — see git history), and
// that the room photo tap opens the shared ImageLightbox, not a duplicate
// viewer implementation.
describe('Home room photo vs room info tap isolation', () => {
  const source = read('app/(tabs)/home.jsx');

  test('room image container and room details are separate TouchableOpacity elements', () => {
    const imageContainerIndex = source.indexOf('style={styles.roomImageContainer}');
    const detailsIndex = source.indexOf('style={styles.roomDetails}');
    expect(imageContainerIndex).toBeGreaterThan(-1);
    expect(detailsIndex).toBeGreaterThan(-1);
    expect(imageContainerIndex).toBeLessThan(detailsIndex);

    // Each sits on its own TouchableOpacity opening tag (not the same one).
    const beforeImage = source.lastIndexOf('<TouchableOpacity', imageContainerIndex);
    const beforeDetails = source.lastIndexOf('<TouchableOpacity', detailsIndex);
    expect(beforeImage).not.toBe(beforeDetails);
  });

  test('tapping the room image opens the shared image lightbox, not the info modal', () => {
    const imageContainerIndex = source.indexOf('style={styles.roomImageContainer}');
    const nextTouchableClose = source.indexOf('</TouchableOpacity>', imageContainerIndex);
    const imageBlock = source.slice(imageContainerIndex, nextTouchableClose);
    expect(imageBlock).toContain('setImagePreview({ visible: true, images: tenancyRoom.images');
    expect(imageBlock).not.toContain('setModalData');
  });

  test('tapping the room info area opens the info modal, not the image lightbox', () => {
    const detailsIndex = source.indexOf('style={styles.roomDetails}');
    const detailsBlockEnd = source.indexOf('priceValue', detailsIndex);
    const detailsBlock = source.slice(detailsIndex, detailsBlockEnd);
    expect(detailsBlock).toContain('setModalData({');
    expect(detailsBlock).not.toContain('setImagePreview');
  });

  test('Home renders the shared ImageLightbox component rather than a bespoke viewer', () => {
    expect(source).toContain("import ImageLightbox from '../../src/components/ImageLightbox'");
    expect(source).toContain('<ImageLightbox');
    expect(source).not.toContain('RoomImagePreviewModal');
    expect(source).not.toContain('PropertyImagePreviewModal');
  });

  test('room photo tap is disabled (no lightbox) when the room has no real images, so a placeholder never opens an empty viewer', () => {
    const imageContainerIndex = source.indexOf('style={styles.roomImageContainer}');
    const nextTouchableClose = source.indexOf('</TouchableOpacity>', imageContainerIndex);
    const imageBlock = source.slice(imageContainerIndex, nextTouchableClose);
    expect(imageBlock).toContain('disabled={!tenancyRoom?.images?.length}');
  });
});
