/**
 * public-api 守护：测试文件只允许从包根（../src/index.js）或测试内 helpers 导入，
 * 不允许 deep import（src/ 内部模块路径）。
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ALLOWED = new Set(['../src/index.js', './helpers.js', 'vitest', 'node:fs', 'node:url', 'node:path']);

describe('public-api', () => {
  it('测试文件只从包根或 helpers 导入', () => {
    const files = readdirSync(TEST_DIR).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(join(TEST_DIR, file), 'utf8');
      const specifiers = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      for (const spec of specifiers) {
        expect(ALLOWED.has(spec), `${file} 非法导入: ${spec}`).toBe(true);
      }
    }
  });
});
