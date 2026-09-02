/* global test, __dirname */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import ProfilePhotoCropModal from '../components/ProfilePhotoCropModal';
import { getProfileCropLayout } from '../utils/profilePhotoCrop';

jest.mock('../context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      accent: '#d4af37',
      background: '#ffffff',
      border: '#dddddd',
      errorText: '#991b1b',
      surfaceSecondary: '#eeeeee',
      text: '#111111',
      textMuted: '#777777',
      textSecondary: '#444444',
    },
  }),
}));

const asset = {
  uri: 'file:///cache/profile-original.jpg',
  width: 1200,
  height: 800,
  fileName: 'profile-original.jpg',
  mimeType: 'image/jpeg',
};

describe('profile photo crop geometry', () => {
  test('cover layout produces a square source crop and clamps drag offsets', () => {
    expect(getProfileCropLayout(asset, 300, 1, { x: 0, y: 0 }).crop)
      .toEqual({ originX: 200, originY: 0, width: 800, height: 800 });
    expect(getProfileCropLayout(asset, 300, 1, { x: 999, y: 999 }).offset)
      .toEqual({ x: 75, y: 0 });
  });

  test('zoom changes the source crop while keeping it within image bounds', () => {
    const layout = getProfileCropLayout(asset, 300, 2, { x: 0, y: 0 });
    expect(layout.crop).toEqual({ originX: 400, originY: 200, width: 400, height: 400 });
  });

  test('crop surface uses native pan and pinch gestures while the image cannot retain the responder', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../components/ProfilePhotoCropModal.jsx'), 'utf8');
    expect(source).toContain('Gesture.Pan()');
    expect(source).toContain('Gesture.Pinch()');
    expect(source).toContain('Gesture.Simultaneous(pan, pinch)');
    expect(source).toMatch(/<Image\s+pointerEvents="none"/);
  });
});

describe('ProfilePhotoCropModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ImageManipulator.manipulateAsync.mockResolvedValue({
      uri: 'file:///cache/profile-cropped.jpg',
      width: 1024,
      height: 1024,
    });
  });

  test('cancel exits without applying or saving a crop', () => {
    const onCancel = jest.fn();
    const onSave = jest.fn();
    render(<ProfilePhotoCropModal asset={asset} onCancel={onCancel} onSave={onSave} visible />);

    fireEvent.press(screen.getByLabelText('Cancel crop'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(ImageManipulator.manipulateAsync).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  test('crop opens a preview, allows adjustment, and saves only the cropped asset', async () => {
    const onSave = jest.fn();
    render(<ProfilePhotoCropModal asset={asset} onCancel={jest.fn()} onSave={onSave} visible />);

    fireEvent.press(screen.getByLabelText('Zoom in'));
    fireEvent.press(screen.getByLabelText('Crop profile photo'));

    await waitFor(() => expect(screen.getByLabelText('Cropped profile photo preview')).toBeTruthy());
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      asset.uri,
      expect.arrayContaining([expect.objectContaining({ crop: expect.any(Object) })]),
      expect.objectContaining({ compress: 0.85, format: 'jpeg' }),
    );

    fireEvent.press(screen.getByLabelText('Adjust crop'));
    expect(screen.getByLabelText('Profile photo crop area')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Crop profile photo'));
    await waitFor(() => expect(screen.getByLabelText('Save profile photo')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('Save profile photo'));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      uri: 'file:///cache/profile-cropped.jpg',
      fileName: 'profile-photo-cropped.jpg',
      mimeType: 'image/jpeg',
    }));
  });
});
