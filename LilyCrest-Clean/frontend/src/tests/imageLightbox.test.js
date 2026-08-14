// Behavioral tests for the shared ImageLightbox component (frontend/src/components/ImageLightbox.jsx),
// used by both the Home room-photo card and PropertyShowcase's property/branch photos.

import { fireEvent, render } from '@testing-library/react-native';
import { Image as ExpoImage } from 'expo-image';
import { Modal } from 'react-native';
import ImageLightbox from '../components/ImageLightbox';

const IMG_A = 'https://example.com/a.jpg';
const IMG_B = 'https://example.com/b.jpg';
const IMG_C = 'https://example.com/c.jpg';

describe('ImageLightbox', () => {
  it('renders nothing meaningful when not visible (Modal visible=false)', () => {
    const { UNSAFE_getByType } = render(
      <ImageLightbox visible={false} images={[IMG_A]} initialIndex={0} onClose={jest.fn()} />
    );
    expect(UNSAFE_getByType(Modal).props.visible).toBe(false);
  });

  it('opens directly on the tapped image, not always index 0', () => {
    const { getByText } = render(
      <ImageLightbox visible images={[IMG_A, IMG_B, IMG_C]} initialIndex={2} onClose={jest.fn()} />
    );
    expect(getByText('3 / 3')).toBeTruthy();
  });

  it('hides the counter and nav buttons for a single image', () => {
    const { queryByText, queryByLabelText } = render(
      <ImageLightbox visible images={[IMG_A]} initialIndex={0} onClose={jest.fn()} />
    );
    expect(queryByText('1 / 1')).toBeNull();
    expect(queryByLabelText('Next image')).toBeNull();
    expect(queryByLabelText('Previous image')).toBeNull();
  });

  it('navigates forward and backward through multiple images', () => {
    const { getByText, getByLabelText } = render(
      <ImageLightbox visible images={[IMG_A, IMG_B, IMG_C]} initialIndex={0} onClose={jest.fn()} />
    );
    expect(getByText('1 / 3')).toBeTruthy();

    fireEvent.press(getByLabelText('Next image'));
    expect(getByText('2 / 3')).toBeTruthy();

    fireEvent.press(getByLabelText('Next image'));
    expect(getByText('3 / 3')).toBeTruthy();

    fireEvent.press(getByLabelText('Previous image'));
    expect(getByText('2 / 3')).toBeTruthy();
  });

  it('disables Previous at the first image and Next at the last image', () => {
    const { getByLabelText } = render(
      <ImageLightbox visible images={[IMG_A, IMG_B]} initialIndex={0} onClose={jest.fn()} />
    );
    expect(getByLabelText('Previous image').props.accessibilityState?.disabled).toBe(true);

    fireEvent.press(getByLabelText('Next image'));
    expect(getByLabelText('Next image').props.accessibilityState?.disabled).toBe(true);
  });

  it('shows a graceful error state for a broken image without crashing, and navigation still works', () => {
    const { getByLabelText, getByText, UNSAFE_getAllByType } = render(
      <ImageLightbox visible images={[IMG_A, 'https://example.com/broken.jpg', IMG_C]} initialIndex={1} onClose={jest.fn()} />
    );
    const brokenImage = UNSAFE_getAllByType(ExpoImage)[0];
    fireEvent(brokenImage, 'onError');
    expect(getByText('Unable to load this image.')).toBeTruthy();

    // Still able to move to the next, valid image after an error.
    fireEvent.press(getByLabelText('Next image'));
    expect(getByText('3 / 3')).toBeTruthy();
  });

  it('calls onClose when the close button is pressed', () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(
      <ImageLightbox visible images={[IMG_A]} initialIndex={0} onClose={onClose} />
    );
    fireEvent.press(getByLabelText('Close image preview'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Android hardware/software Back (Modal onRequestClose)', () => {
    const onClose = jest.fn();
    const { UNSAFE_getByType } = render(
      <ImageLightbox visible images={[IMG_A]} initialIndex={0} onClose={onClose} />
    );
    UNSAFE_getByType(Modal).props.onRequestClose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('resets to the new initialIndex when reopened at a different photo', () => {
    const { getByText, rerender } = render(
      <ImageLightbox visible={false} images={[IMG_A, IMG_B, IMG_C]} initialIndex={0} onClose={jest.fn()} />
    );
    rerender(<ImageLightbox visible images={[IMG_A, IMG_B, IMG_C]} initialIndex={1} onClose={jest.fn()} />);
    expect(getByText('2 / 3')).toBeTruthy();
  });

  it('accepts local require(...) assets (numbers) alongside remote URL strings without crashing', () => {
    const localAsset = 1234; // require(...) resolves to a number under Jest's asset transform
    const { getByText } = render(
      <ImageLightbox visible images={[localAsset, IMG_B]} initialIndex={0} onClose={jest.fn()} />
    );
    expect(getByText('1 / 2')).toBeTruthy();
  });

  it('filters out null/undefined/empty entries without breaking navigation', () => {
    const { getByText } = render(
      <ImageLightbox visible images={[IMG_A, null, undefined, '', IMG_B]} initialIndex={0} onClose={jest.fn()} />
    );
    expect(getByText('1 / 2')).toBeTruthy();
  });
});
