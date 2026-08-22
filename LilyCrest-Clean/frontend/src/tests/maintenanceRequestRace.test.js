/* global __dirname, test */
import fs from 'node:fs';
import path from 'node:path';
import { createLatestRequestGate, runLatestRequest } from '../utils/latestRequest';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('maintenance request refresh ordering', () => {
  test('a slower old response cannot overwrite the newer response', async () => {
    const gate = createLatestRequestGate();
    const older = deferred();
    const newer = deferred();
    const applied = [];
    const settled = [];

    const oldRun = runLatestRequest({
      gate,
      request: () => older.promise,
      onSuccess: (value) => applied.push(value),
      onSettled: () => settled.push('old'),
    });
    const newRun = runLatestRequest({
      gate,
      request: () => newer.promise,
      onSuccess: (value) => applied.push(value),
      onSettled: () => settled.push('new'),
    });

    newer.resolve('newest data');
    await newRun;
    older.resolve('stale data');
    await oldRun;

    expect(applied).toEqual(['newest data']);
    expect(settled).toEqual(['new']);
  });

  test('a stale failure cannot replace a newer successful state with an error', async () => {
    const gate = createLatestRequestGate();
    const older = deferred();
    const newer = deferred();
    const applied = [];
    const errors = [];

    const oldRun = runLatestRequest({
      gate,
      request: () => older.promise,
      onError: (error) => errors.push(error.message),
    });
    const newRun = runLatestRequest({
      gate,
      request: () => newer.promise,
      onSuccess: (value) => applied.push(value),
    });

    newer.resolve('newest data');
    await newRun;
    older.reject(new Error('stale network failure'));
    await oldRun;

    expect(applied).toEqual(['newest data']);
    expect(errors).toEqual([]);
  });

  test('the Services lifecycle has one immediate focus fetch and invalidates on blur', () => {
    const root = path.resolve(__dirname, '../..');
    const screen = fs.readFileSync(path.join(root, 'app/(tabs)/services.jsx'), 'utf8');
    const lifecycle = screen.slice(
      screen.indexOf('useFocusEffect('),
      screen.indexOf('const onRefresh'),
    );

    expect(lifecycle.match(/^\s+fetchRequests\(\);$/gm)).toHaveLength(1);
    expect(lifecycle).toContain('requestGateRef.current.invalidate()');
    expect(screen).toContain('runLatestRequest({');
  });
});
