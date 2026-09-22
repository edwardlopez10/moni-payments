import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_ROOTS = ['src', 'prisma', 'openapi.json'];

/** Domain vocabulary products must not leak into Payments. */
const FORBIDDEN_DOMAIN =
  /\b(residents?|residences?|patients?|doctors?|appointments?|visits?|units?|clinics?)\b/i;

/** Allowed enum / channel identifiers (not domain concepts). */
function isAllowedDomainMatch(line: string, match: string): boolean {
  if (match.toUpperCase() === 'RESIDENT' || match.toUpperCase() === 'HEALTH') {
    // Allow SourceProduct enum members and string literals of those enums.
    if (
      /SourceProduct|sourceProduct|source_product|enum\s+SourceProduct/i.test(line) ||
      /['"]RESIDENT['"]|['"]HEALTH['"]|\bRESIDENT\b|\bHEALTH\b/.test(line) &&
        !/\bresident\b|\bhealth\b/.test(line.replace(/RESIDENT|HEALTH/g, ''))
    ) {
      // If the only hit is the uppercase enum token, allow.
      if (match === 'RESIDENT' || match === 'HEALTH') {
        return true;
      }
    }
    if (match === 'RESIDENT' || match === 'HEALTH') {
      return true;
    }
  }
  return false;
}

const PROVIDER_SDK =
  /from\s+['"][^'"]*(pagadito|wompi|payway|stripe|adyen|braintree)[^'"]*['"]|require\(['"][^'"]*(pagadito|wompi|payway|stripe)[^'"]*['"]\)/i;

const PRODUCT_DB =
  /(DATABASE_URL|connectionString|datasources).*?(moni_resident|moni_health|resident_db|health_db)/i;

function walk(path: string, files: string[]): void {
  let st;
  try {
    st = statSync(path);
  } catch {
    return;
  }
  if (st.isFile()) {
    files.push(path);
    return;
  }
  if (!st.isDirectory()) return;
  for (const name of readdirSync(path)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    walk(join(path, name), files);
  }
}

function collectFiles(): string[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    walk(join(ROOT, root), files);
  }
  return files.filter((f) => /\.(ts|prisma|sql|json)$/.test(f));
}

function main(): void {
  const errors: string[] = [];
  const files = collectFiles();

  for (const file of files) {
    const rel = relative(ROOT, file);
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');

    for (const [i, line] of lines.entries()) {
      const domain = line.match(FORBIDDEN_DOMAIN);
      if (domain && !isAllowedDomainMatch(line, domain[1] ?? domain[0])) {
        errors.push(`${rel}:${i + 1}: forbidden domain term "${domain[0]}"`);
      }
      if (PRODUCT_DB.test(line)) {
        errors.push(`${rel}:${i + 1}: product database reference`);
      }
      if (PROVIDER_SDK.test(line)) {
        const inProviderAdapter = /^src\/providers\/[^/]+\//.test(rel);
        if (!inProviderAdapter) {
          errors.push(`${rel}:${i + 1}: provider SDK import outside adapter`);
        }
      }
    }
  }

  // "unit" is a common word (e.g. minor units) — soften false positives for money language.
  const filtered = errors.filter((e) => !/\bunits?\b/i.test(e) || /apartment|condo|dwelling/i.test(e));

  // Actually "unit" alone is too blunt per spec — but money code uses "minor units".
  // Re-filter: only fail "unit" when not part of "minor unit(s)" / "unit test" / TypeScript Unit.
  const refined: string[] = [];
  for (const err of errors) {
    const unitOnly = /forbidden domain term "units?"/i.test(err);
    if (unitOnly) {
      const [loc] = err.split(': forbidden');
      const [file, lineNo] = [loc?.replace(/:\d+$/, ''), loc?.match(/:(\d+)$/)?.[1]];
      if (file && lineNo) {
        const line = readFileSync(join(ROOT, file), 'utf8').split('\n')[Number(lineNo) - 1] ?? '';
        if (/minor\s+units?|unit\s+tests?|Unit\b|monetary/i.test(line)) {
          continue;
        }
      }
    }
    refined.push(err);
    void filtered;
  }

  if (refined.length > 0) {
    console.error('Domain boundary check failed:\n' + refined.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }
  console.log('Domain boundary check passed.');
}

main();
