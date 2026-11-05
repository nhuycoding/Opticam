import { describe, expect, it } from 'vitest';
import { PRESETS, withManualCams } from '../data/presets';
import { runFrontendUiTests } from './uiTestRunner';

describe('in-app frontend self-tests', () => {
  it('runs the self-test checks against an active sample layout', async () => {
    const results = await runFrontendUiTests(withManualCams(PRESETS[0]));

    expect(results).toHaveLength(6);
    expect(results.every((result) => result.group === 'frontend')).toBe(true);
    expect(results.filter((result) => result.status === 'failed')).toEqual([]);
    expect(results.every((result) => result.durationMs >= 0)).toBe(true);
  });
});
