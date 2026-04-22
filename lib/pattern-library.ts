// Pattern library: detects anti-patterns in proposed code changes.
// Used by fix-candidate-generator to validate that a fix doesn't introduce
// new problems. Returns structured findings so callers can filter or flag.

export type PatternSeverity = 'error' | 'warning' | 'info';

export type PatternFinding = {
  rule: string;
  severity: PatternSeverity;
  line: number;
  column?: number;
  message: string;
  suggestion: string;
};

export type PatternCheckResult = {
  passed: boolean;   // true if no error-severity findings
  score: number;     // 0-1, 1 = perfectly clean
  findings: PatternFinding[];
};

// ── Rule definitions ──────────────────────────────────────────────────────────

type Rule = {
  id: string;
  severity: PatternSeverity;
  description: string;
  suggestion: string;
  test: (line: string, lineNum: number, allLines: string[]) => boolean;
};

const RULES: Rule[] = [
  {
    id: 'no-map-without-guard',
    severity: 'error',
    description: 'Calling .map() on a value that could be undefined/null',
    suggestion: 'Add optional chaining: `value?.map(...)` or guard with `Array.isArray(value) &&`',
    test: (line) => {
      // Flag .map( that isn't preceded by ?. or Array.isArray guard on the same line
      if (!line.includes('.map(')) return false;
      if (line.includes('?.map(')) return false;
      // Check for patterns like someVar.map( where someVar might be nullable
      return /(?<!Array\.isArray\([^)]+\)\s*&&[^;]*)\b\w+\.map\s*\(/.test(line);
    },
  },
  {
    id: 'no-filter-without-guard',
    severity: 'warning',
    description: 'Calling .filter() on a potentially undefined value',
    suggestion: 'Use optional chaining: `value?.filter(...)` or ensure the value is initialised',
    test: (line) => /(?<!\?)\b\w+\.filter\s*\(/.test(line) && !line.includes('?.filter('),
  },
  {
    id: 'no-property-access-without-guard',
    severity: 'warning',
    description: 'Accessing a nested property without optional chaining on potentially undefined object',
    suggestion: 'Use optional chaining: `obj?.prop` instead of `obj.prop`',
    test: (line) => {
      // Only flag patterns like `data.items.length` (two-level access) without ?.
      return /\b\w+\.\w+\.\w+/.test(line) && !line.includes('?.') && !line.trim().startsWith('//');
    },
  },
  {
    id: 'no-useeffect-missing-cleanup',
    severity: 'warning',
    description: 'useEffect with event listeners or timers may be missing cleanup return',
    suggestion: 'Return a cleanup function from useEffect to remove listeners/clear timers',
    test: (line, lineNum, allLines) => {
      if (!line.includes('addEventListener') && !line.includes('setInterval') && !line.includes('setTimeout')) return false;
      // Check if there's a return () => in the surrounding 15 lines
      const context = allLines.slice(Math.max(0, lineNum - 10), lineNum + 10).join('\n');
      return !context.includes('return ()');
    },
  },
  {
    id: 'no-console-log',
    severity: 'info',
    description: 'console.log left in production code',
    suggestion: 'Remove or replace with proper error logging',
    test: (line) => /console\.log\s*\(/.test(line) && !line.trim().startsWith('//'),
  },
  {
    id: 'no-any-cast',
    severity: 'warning',
    description: 'TypeScript `as any` cast disables type safety',
    suggestion: 'Use a proper type or `as unknown as TargetType`',
    test: (line) => /\bas\s+any\b/.test(line) && !line.trim().startsWith('//'),
  },
  {
    id: 'no-empty-catch',
    severity: 'warning',
    description: 'Empty catch block swallows errors silently',
    suggestion: 'At minimum log the error: `catch (e) { console.error(e); }`',
    test: (line, lineNum, allLines) => {
      if (!line.includes('} catch')) return false;
      const next = allLines[lineNum]?.trim() ?? '';
      return next === '}' || next === '/* empty */' || next === '';
    },
  },
  {
    id: 'missing-key-prop',
    severity: 'error',
    description: 'JSX list render without key prop',
    suggestion: 'Add a stable key prop: `key={item.id}` or `key={index}` as last resort',
    test: (line, lineNum, allLines) => {
      if (!line.includes('.map(')) return false;
      // Look for JSX return in the next 3 lines without key=
      const ahead = allLines.slice(lineNum, lineNum + 4).join('\n');
      return ahead.includes('<') && !ahead.includes('key=');
    },
  },
  {
    id: 'no-magic-number',
    severity: 'info',
    description: 'Magic number used without a named constant',
    suggestion: 'Extract to a named constant for readability',
    test: (line) => {
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return false;
      // Flag standalone numbers > 10 that aren't part of CSS or obvious sizing
      return /(?<![.\w])[2-9]\d{2,}(?![.\w%px])/.test(line);
    },
  },
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check a code string (e.g. a proposed fix) against the anti-pattern library.
 * Returns a structured result with per-finding details and an overall score.
 */
export function checkPatterns(code: string): PatternCheckResult {
  const lines = code.split('\n');
  const findings: PatternFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of RULES) {
      if (rule.test(line, i, lines)) {
        findings.push({
          rule: rule.id,
          severity: rule.severity,
          line: i + 1,
          message: rule.description,
          suggestion: rule.suggestion,
        });
      }
    }
  }

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warnCount = findings.filter((f) => f.severity === 'warning').length;

  // Score: start at 1.0, deduct 0.25 per error, 0.1 per warning, 0.02 per info
  const score = Math.max(
    0,
    1.0 - errorCount * 0.25 - warnCount * 0.1 - findings.filter((f) => f.severity === 'info').length * 0.02
  );

  return {
    passed: errorCount === 0,
    score: Math.round(score * 100) / 100,
    findings,
  };
}

/**
 * Summarise findings for display — groups by severity.
 */
export function summariseFindings(result: PatternCheckResult): string {
  if (result.findings.length === 0) return 'No anti-patterns detected.';
  return result.findings
    .map((f) => `[${f.severity.toUpperCase()}] L${f.line} ${f.rule}: ${f.message}`)
    .join('\n');
}
