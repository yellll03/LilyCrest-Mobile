import fs from 'fs';
import path from 'path';

const root = path.resolve(process.cwd());
const screen = fs.readFileSync(path.join(root, 'app/room-transfer.jsx'), 'utf8');
const home = fs.readFileSync(path.join(root, 'app/(tabs)/home.jsx'), 'utf8');
const api = fs.readFileSync(path.join(root, 'src/services/api.js'), 'utf8');

describe('mobile room transfer connection', () => {
  it('submits intent fields only and displays the required confirmation disclaimer', () => {
    for (const field of ['preferredRoomType', 'preferredRoomId', 'preferredTransferDate', 'reason', 'note']) {
      expect(screen).toContain(field);
    }
    for (const forbidden of ['targetBedId', 'meterReading', 'settlementBill', 'addendumContract']) {
      expect(screen).not.toContain(forbidden);
    }
    expect(screen).toContain('Room preference and transfer date are subject to Admin confirmation.');
  });

  it('shows backend status and blocks scheduled tenant cancellation in presentation state', () => {
    expect(screen).toContain('presentation.statusLabel');
    expect(screen).toContain('presentation.canCancel');
    expect(screen).toContain('Please coordinate with the Administration Office for changes to a scheduled room transfer.');
  });

  it('connects Home and the native screen to the canonical mobile routes', () => {
    expect(home).toContain("router.push('/room-transfer')");
    expect(home).toContain('getCurrentRoomTransfer');
    expect(api).toContain("api.get('/room-transfer-request/current')");
    expect(api).toContain("api.post('/room-transfer-requests'");
    expect(api).toContain('cancelRoomTransferRequest');
    expect(api).toContain("api.get('/room-transfer-preferences')");
    expect(screen).not.toContain('apiService.getRooms');
  });

  it('treats lifecycle failures as unknown, refreshes on resume, and reconciles 409 mutations', () => {
    expect(screen).toContain('loadError');
    expect(screen).toContain('Unable to load your room transfer status.');
    expect(screen).toContain("AppState.addEventListener('change'");
    expect(screen).toContain('error?.response?.status === 409');
    const submitBody = screen.slice(screen.indexOf('const submit ='), screen.indexOf('const cancel ='));
    expect(submitBody).not.toContain('setLifecycle(');
    expect(home).toContain('roomTransferLoaded');
    expect(home).toContain('Status unavailable');
  });
});
