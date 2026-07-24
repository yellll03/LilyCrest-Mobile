'use strict';

const BASE_FIELDS = Object.freeze({
  executionDay: { page: 1, x: 342.22, y: 847.2, width: 22.48, height: 8, align: 'center', maxFontSize: 7.2, minFontSize: 6 },
  executionMonthYear: { page: 1, x: 394.94, y: 847.2, width: 74.92, height: 8, align: 'center', maxFontSize: 7.2, minFontSize: 5.8 },
  tenantLegalName: { page: 1, x: 47.25, y: 793.6, width: 153.59, height: 8, align: 'center', maxFontSize: 7.2, minFontSize: 5.2 },
  tenantAddress: { page: 1, x: 47.25, y: 784.95, width: 213.5, height: 8, align: 'center', maxFontSize: 7.1, minFontSize: 4.8 },
});

const SECTION_4_STANDARD = Object.freeze({
  advanceCoverageStart: { page: 1, x: 179.89, y: 489.3, width: 74.92, height: 8, align: 'center', maxFontSize: 7, minFontSize: 4.8 },
  advanceCoverageEnd: { page: 1, x: 264.12, y: 489.3, width: 74.92, height: 8, align: 'center', maxFontSize: 7, minFontSize: 4.8 },
});

const SECTION_4_PRIVATE_SHORT = Object.freeze({
  advanceCoverageStart: { page: 1, x: 183.64, y: 480.65, width: 74.92, height: 8, align: 'center', maxFontSize: 7, minFontSize: 4.8 },
  advanceCoverageEnd: { page: 1, x: 267.30, y: 480.65, width: 74.92, height: 8, align: 'center', maxFontSize: 7, minFontSize: 4.8 },
});

const BED_SPACE_SCHEDULE_SHORT = Object.freeze({
  leaseDurationWords: { page: 1, x: 364.44, y: 648.35, width: 37.46, height: 8, align: 'center', maxFontSize: 7.1, minFontSize: 5.5 },
  leaseDurationNumber: { page: 1, x: 409.49, y: 648.35, width: 22.48, height: 8, align: 'center', maxFontSize: 7.1, minFontSize: 5.5 },
  moveInDate: { page: 1, x: 495.43, y: 648.35, width: 68.78, height: 8, align: 'center', maxFontSize: 7, minFontSize: 4.8 },
  moveOutDate: { page: 1, x: 58.08, y: 639.7, width: 74.92, height: 8, align: 'center', maxFontSize: 7, minFontSize: 4.8 },
});

const BED_SPACE_SCHEDULE_LONG = Object.freeze({
  ...BED_SPACE_SCHEDULE_SHORT,
  moveOutDate: { ...BED_SPACE_SCHEDULE_SHORT.moveOutDate, x: 58.27 },
});

const PRIVATE_SCHEDULE_SHORT = Object.freeze({
  leaseDurationWords: { page: 1, x: 420.17, y: 648.35, width: 37.46, height: 8, align: 'center', maxFontSize: 7.1, minFontSize: 5.5 },
  leaseDurationNumber: { page: 1, x: 472.49, y: 648.35, width: 22.48, height: 8, align: 'center', maxFontSize: 7.1, minFontSize: 5.5 },
  moveInDate: { page: 1, x: 47.25, y: 639.7, width: 74.92, height: 8, align: 'center', maxFontSize: 7, minFontSize: 4.8 },
  moveOutDate: { page: 1, x: 131.34, y: 639.7, width: 74.92, height: 8, align: 'center', maxFontSize: 7, minFontSize: 4.8 },
});

const PRIVATE_SCHEDULE_LONG = Object.freeze({
  ...PRIVATE_SCHEDULE_SHORT,
  moveOutDate: { ...PRIVATE_SCHEDULE_SHORT.moveOutDate, x: 131.63 },
});

function map(roomNumber, bedSlot, schedule, section4 = SECTION_4_STANDARD) {
  return Object.freeze({
    ...BASE_FIELDS,
    roomNumber,
    bedSlot,
    ...schedule,
    ...section4,
  });
}

const TEMPLATE_FIELD_MAPS = Object.freeze({
  PRIVATE_ROOM_SHORT_TERM: map(
    { page: 1, x: 477.07, y: 739.98, width: 37.46, height: 8, align: 'center', maxFontSize: 7, minFontSize: 5.2 },
    { page: 1, x: 47.25, y: 731.35, width: 37.46, height: 8, align: 'center', maxFontSize: 7, minFontSize: 5.2 },
    PRIVATE_SCHEDULE_SHORT,
    SECTION_4_PRIVATE_SHORT,
  ),
  PRIVATE_ROOM_LONG_TERM: map(
    { page: 1, x: 477.07, y: 739.98, width: 37.46, height: 8, align: 'center', maxFontSize: 7, minFontSize: 5.2 },
    { page: 1, x: 47.25, y: 731.35, width: 37.46, height: 8, align: 'center', maxFontSize: 7, minFontSize: 5.2 },
    PRIVATE_SCHEDULE_LONG,
  ),
  DOUBLE_SHARING_SHORT_TERM: map(
    { page: 1, x: 493.60, y: 739.98, width: 37.46, height: 8, align: 'center', maxFontSize: 7, minFontSize: 5.2 },
    { page: 1, x: 63.28, y: 731.35, width: 37.46, height: 8, align: 'center', maxFontSize: 7, minFontSize: 5.2 },
    BED_SPACE_SCHEDULE_SHORT,
  ),
  DOUBLE_SHARING_LONG_TERM: map(
    { page: 1, x: 493.60, y: 739.98, width: 37.46, height: 8, align: 'center', maxFontSize: 7, minFontSize: 5.2 },
    { page: 1, x: 63.28, y: 731.35, width: 37.46, height: 8, align: 'center', maxFontSize: 7, minFontSize: 5.2 },
    BED_SPACE_SCHEDULE_LONG,
  ),
  QUADRUPLE_SHARING_SHORT_TERM: map(
    { page: 1, x: 527.95, y: 739.98, width: 37.46, height: 8, align: 'center', maxFontSize: 7, minFontSize: 5.2 },
    { page: 1, x: 98.08, y: 731.35, width: 37.46, height: 8, align: 'center', maxFontSize: 7, minFontSize: 5.2 },
    BED_SPACE_SCHEDULE_SHORT,
  ),
  QUADRUPLE_SHARING_LONG_TERM: map(
    { page: 1, x: 527.95, y: 739.98, width: 37.46, height: 8, align: 'center', maxFontSize: 7, minFontSize: 5.2 },
    { page: 1, x: 98.08, y: 731.35, width: 37.46, height: 8, align: 'center', maxFontSize: 7, minFontSize: 5.2 },
    BED_SPACE_SCHEDULE_LONG,
  ),
});

function fieldMapFor(templateKey) {
  return TEMPLATE_FIELD_MAPS[templateKey] || null;
}

module.exports = { TEMPLATE_FIELD_MAPS, fieldMapFor };
