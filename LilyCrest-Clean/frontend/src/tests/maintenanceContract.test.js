/* global test */
import React from 'react';
import { Text, View } from 'react-native';
import { render } from '@testing-library/react-native';

import {
  CANONICAL_MAINTENANCE_REQUEST_TYPES,
  CANONICAL_MAINTENANCE_URGENCIES,
  MAX_MAINTENANCE_ATTACHMENTS,
  extractMaintenanceList,
  extractMaintenanceRequest,
  getMaintenanceLocationParts,
  getMaintenanceRequestBranchDisplayName,
  getMaintenanceRequestFloorDisplayName,
  getMaintenanceRequestRoomDisplayName,
  getMaintenanceRoomDisplayName,
  getMaintenanceRoomIdentifier,
  getMaintenanceTenantActions,
  normalizeMaintenanceRequest,
  reconcileMaintenanceRequest,
  toMaintenanceRoomOption,
} from '../utils/maintenanceContract';

describe('canonical mobile maintenance contract', () => {
  test('exposes the canonical categories, urgency semantics, and attachment limit', () => {
    expect(CANONICAL_MAINTENANCE_REQUEST_TYPES).toEqual([
      'maintenance', 'plumbing', 'electrical', 'aircon', 'elevator',
      'furniture', 'internet', 'cleaning', 'pest', 'other',
    ]);
    expect(CANONICAL_MAINTENANCE_URGENCIES).toEqual([
      'low', 'normal', 'high', 'urgent', 'emergency',
    ]);
    expect(MAX_MAINTENANCE_ATTACHMENTS).toBe(5);
  });

  test('consumes canonical envelopes and legacy responses during rollout', () => {
    const request = { request_id: 'm1' };
    expect(extractMaintenanceList({ data: { data: { requests: [request] } } })[0])
      .toEqual(expect.objectContaining(request));
    expect(extractMaintenanceList({ data: [request] })[0])
      .toEqual(expect.objectContaining(request));
    expect(extractMaintenanceRequest({ data: { data: { request } } }))
      .toEqual(expect.objectContaining(request));
    expect(extractMaintenanceRequest({ data: request }))
      .toEqual(expect.objectContaining(request));
  });

  test('normalizes a populated room object into scalar identifier and display fields', () => {
    const room = {
      _id: 'room-101-id',
      name: 'Room 101',
      roomNumber: '101',
      floor: 1,
      branch: { _id: 'branch-gp', name: 'Gil Puyat' },
      isFull: false,
      availableSlots: 2,
      id: 'room-101-id',
    };

    const request = normalizeMaintenanceRequest({ request_id: 'm1', roomId: room });

    expect(request.roomId).toBe('room-101-id');
    expect(request.room_id).toBe('room-101-id');
    expect(request.roomLabel).toBe('101');
    expect(request.branch).toBe('Gil Puyat');
    expect(request.floor).toBe('1');
    expect(getMaintenanceRequestRoomDisplayName(request)).toBe('101');
    expect(getMaintenanceRequestBranchDisplayName(request)).toBe('Gil Puyat');
    expect(getMaintenanceRequestFloorDisplayName(request)).toBe('1');
  });

  test.each([
    ['legacy string', 'Room 204', 'Room 204', 'Room 204'],
    ['null room', null, null, '—'],
  ])('renders %s safely', (_label, room, expectedId, expectedDisplay) => {
    const request = normalizeMaintenanceRequest({ request_id: 'm1', room });
    expect(request.roomId).toBe(expectedId);
    expect(getMaintenanceRoomIdentifier(room)).toBe(expectedId);
    expect(getMaintenanceRoomDisplayName(room)).toBe(expectedDisplay);
    expect(getMaintenanceRequestRoomDisplayName(request)).toBe(expectedDisplay);
  });

  test('prefers an explicit room number over a legacy room identifier for display', () => {
    const request = normalizeMaintenanceRequest({
      request_id: 'm1',
      room: '507f1f77bcf86cd799439011',
      roomNumber: '204',
    });

    expect(request.roomId).toBe('507f1f77bcf86cd799439011');
    expect(getMaintenanceRequestRoomDisplayName(request)).toBe('204');
  });

  test('maps room selectors to separate scalar identifier and label values', () => {
    expect(toMaintenanceRoomOption({
      _id: 'room-305-id',
      roomNumber: '305',
      name: 'Room 305',
      branch: 'Guadalupe',
      floor: 3,
    })).toEqual({
      id: 'room-305-id',
      value: 'room-305-id',
      label: '305',
      roomNumber: '305',
      branch: 'Guadalupe',
      floor: '3',
    });
  });

  test('produces only render-safe scalar card and detail values', () => {
    const request = extractMaintenanceRequest({ data: {
      request_id: 'm1',
      branch: { name: 'Gil Puyat' },
      roomId: {
        _id: 'room-401-id',
        roomNumber: '401',
        floor: { number: 4 },
        branch: { name: 'Gil Puyat' },
      },
    } });
    const cardLocationParts = getMaintenanceLocationParts(request);
    const detailValues = [
      getMaintenanceRequestBranchDisplayName(request, 'Not specified'),
      getMaintenanceRequestRoomDisplayName(request, 'Not specified'),
      getMaintenanceRequestFloorDisplayName(request, ''),
    ];

    expect(cardLocationParts).toEqual(['Gil Puyat', '401']);
    expect([...cardLocationParts, ...detailValues].every((value) => typeof value === 'string')).toBe(true);
    expect(() => cardLocationParts.join(' / ')).not.toThrow();

    let rendered;
    expect(() => {
      rendered = render(React.createElement(
        View,
        null,
        React.createElement(Text, null, cardLocationParts.join(' / ')),
        ...detailValues.map((value, index) => React.createElement(Text, { key: index }, value)),
      ));
    }).not.toThrow();
    expect(rendered.getAllByText('Gil Puyat').length).toBeGreaterThan(0);
    expect(rendered.getAllByText('401').length).toBeGreaterThan(0);
    rendered.unmount();
  });

  test('uses server-returned action capabilities and reconciles returned DTOs', () => {
    const request = {
      request_id: 'm1',
      tenantActions: { canCancel: true, canRequestReschedule: false },
    };
    expect(getMaintenanceTenantActions(request)).toEqual({
      canEdit: false,
      canCancel: true,
      canReopen: false,
      canConfirmResolution: false,
      canRequestReschedule: false,
      canReply: false,
      canSubmitSimilar: false,
    });
    expect(reconcileMaintenanceRequest([{ request_id: 'm1', status: 'pending' }, { request_id: 'm2' }], { request_id: 'm1', status: 'cancelled' }))
      .toEqual([{ request_id: 'm1', status: 'cancelled' }, { request_id: 'm2' }]);
  });
});
