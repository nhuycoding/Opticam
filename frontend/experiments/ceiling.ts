/** Reproduce from frontend/: node --import tsx experiments/ceiling.ts */
import { writeFileSync } from 'node:fs';
import { PRESETS, withManualCams } from '../src/data/presets';
import { buildZones } from '../src/core/optics';
import { optimizeCameras } from '../src/core/optimizer';
const results = PRESETS.map(preset => {
  const layout = { ...withManualCams(preset), optimization: { algorithm: 'hybrid' as const, mounts: 'mixed' as const } };
  const { cameras, diagnostics } = optimizeCameras(layout, buildZones(layout), 3);
  return { layout: layout.name, requestedCameras: 3, camerasUsed: cameras.length,
    ceilingCameras: cameras.filter(c => c.mount === 'ceiling').length, ...diagnostics,
    gainPercent: diagnostics.greedyScore ? 100 * (diagnostics.finalScore - diagnostics.greedyScore) / diagnostics.greedyScore : 0,
    cameras };
});
const report = { generatedAt: new Date().toISOString(), runtime: process.version,
  method: 'Greedy and one-camera replacement on one shared wall+ceiling candidate pool. Maximum 3 local-search passes; 1,500,000 candidate-cell allocations and 12,000 poses split across unique profiles. Nominal DORI objective on the selected target-height plane; no proof of global optimality. Durations depend on hardware.',
  results };
writeFileSync(new URL('../../results/ceiling-optimization.json', import.meta.url), JSON.stringify(report, null, 2)+'\n');
const columns = ['layout','requestedCameras','camerasUsed','ceilingCameras','greedyScore','finalScore','gainPercent','iterations','candidateCount','ms'] as const;
writeFileSync(new URL('../../results/ceiling-optimization.csv', import.meta.url), columns.join(',')+'\n'+results.map(row=>columns.map(key=>JSON.stringify(row[key])).join(',')).join('\n')+'\n');
for (const row of results) console.log(`${row.layout}: ${row.greedyScore.toFixed(2)} → ${row.finalScore.toFixed(2)} (+${row.gainPercent.toFixed(2)}%), ${row.iterations} swaps, ${row.ms.toFixed(0)} ms`);
