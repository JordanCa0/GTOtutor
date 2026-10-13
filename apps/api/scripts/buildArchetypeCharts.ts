// Builds the premade archetype charts: JEV AI's preflop play for each player type at every chart
// spot of one stack profile, asked once and saved, so play never calls Jev before the flop
// (docs/archetypes.md). Needs JEV_API_KEY in apps/api/.env. Run from the repo root:
//   npx tsx apps/api/scripts/buildArchetypeCharts.ts                          placeholder charts
//   npx tsx apps/api/scripts/buildArchetypeCharts.ts --charts preflop/charts/preflop-v9.json
//   --profile 100          the stack profile to build (default 100; other depths play from the rules)
//   --archetypes fish,nit  only these player types (default all four)
// Writes preflop/charts/archetypes/<the profile's chart version>.json (stacks-v1's 100 is preflop-v9).
// The server uses only the 100bb file. A stopped build resumes where it left off.
import { ARCHETYPES, type Archetype } from '@gtotutor/shared-types';
import { ArchetypeService } from '../src/archetypes/archetypeService.js';
import { jevFromEnv } from '../src/archetypes/jevClient.js';
import { ChartService } from '../src/charts/chartService.js';
import { chartsFromEnv } from '../src/charts/solvedCharts.js';

try {
  process.loadEnvFile('apps/api/.env');
} catch {
  // No .env: JEV_API_KEY may be set in the shell.
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const charts = new ChartService(chartsFromEnv(arg('--charts') ?? ''));
const profile = arg('--profile') ?? '100';
const archetypes = (arg('--archetypes')?.split(',') ?? ARCHETYPES) as Archetype[];
const unknown = archetypes.filter((a) => !ARCHETYPES.includes(a));
if (unknown.length) throw new Error(`Unknown player types: ${unknown.join(', ')}`);
const jev = jevFromEnv();
if (!jev) throw new Error('Set JEV_API_KEY in apps/api/.env first.');

// Named by the profile's own chart file, so a manifest's 100bb profile shares preflop-v9's file.
const version = charts.profileVersion(profile);
const out = `preflop/charts/archetypes/${version}.json`;
const service = new ArchetypeService(jev, { chartsFile: out, chartsVersion: version, log: (msg) => console.warn(msg) });

// Every node the charts hold for the profile. The "|nocall" variants the charts derive (the call
// turned into a fold) reuse their base node's answers the same way, so they aren't asked separately.
const keys = charts.nodeKeys().filter((k) => k.split('|')[1] === profile);
if (!keys.length) throw new Error(`No chart nodes for profile ${profile}.`);
console.log(`${version}, profile ${profile}: ${keys.length} spots x ${archetypes.length} player types -> ${out}`);

let done = 0;
const total = keys.length * archetypes.length;
for (const archetype of archetypes) {
  for (const key of keys) {
    const requests = service.build(archetype, charts.getNode(key));
    await service.idle();
    done++;
    if (requests) {
      service.save();
      console.log(`[${done}/${total}] ${archetype} ${key}: ${requests} requests`);
    }
  }
}
service.save();
console.log(`Done: ${service.chartedNodes} spots in ${out}. Run it again to fill any hands a failed request missed.`);
