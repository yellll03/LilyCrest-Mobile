export const PROFILE_CROP_MIN_ZOOM = 1;
export const PROFILE_CROP_MAX_ZOOM = 3;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function getProfileCropLayout(asset, cropSize, zoom = 1, offset = { x: 0, y: 0 }) {
  const sourceWidth = positiveNumber(asset?.width, 1);
  const sourceHeight = positiveNumber(asset?.height, 1);
  const viewport = positiveNumber(cropSize, 1);
  const normalizedZoom = clamp(
    positiveNumber(zoom, PROFILE_CROP_MIN_ZOOM),
    PROFILE_CROP_MIN_ZOOM,
    PROFILE_CROP_MAX_ZOOM,
  );
  const baseScale = Math.max(viewport / sourceWidth, viewport / sourceHeight);
  const scale = baseScale * normalizedZoom;
  const displayWidth = sourceWidth * scale;
  const displayHeight = sourceHeight * scale;
  const maxOffsetX = Math.max(0, (displayWidth - viewport) / 2);
  const maxOffsetY = Math.max(0, (displayHeight - viewport) / 2);
  const clampedOffset = {
    x: clamp(Number(offset?.x) || 0, -maxOffsetX, maxOffsetX),
    y: clamp(Number(offset?.y) || 0, -maxOffsetY, maxOffsetY),
  };
  const cropWidth = Math.min(sourceWidth, viewport / scale);
  const cropHeight = Math.min(sourceHeight, viewport / scale);
  const originX = clamp(
    ((displayWidth - viewport) / 2 - clampedOffset.x) / scale,
    0,
    Math.max(0, sourceWidth - cropWidth),
  );
  const originY = clamp(
    ((displayHeight - viewport) / 2 - clampedOffset.y) / scale,
    0,
    Math.max(0, sourceHeight - cropHeight),
  );

  return {
    crop: {
      originX: Math.round(originX),
      originY: Math.round(originY),
      width: Math.max(1, Math.round(cropWidth)),
      height: Math.max(1, Math.round(cropHeight)),
    },
    displayHeight,
    displayWidth,
    maxOffsetX,
    maxOffsetY,
    offset: clampedOffset,
    scale,
    zoom: normalizedZoom,
  };
}

export function clampProfileCropOffset(asset, cropSize, zoom, offset) {
  return getProfileCropLayout(asset, cropSize, zoom, offset).offset;
}
