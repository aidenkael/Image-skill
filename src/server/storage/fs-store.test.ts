import { describe, expect, it } from 'vitest';
import { runtimePath, UUID_RE } from './fs-store';

/**
 * 存储安全守卫测试：路径穿越拒绝、任务/资源 id 必须为 UUID。
 */

describe('runtimePath 防目录穿越', () => {
  it('合法子路径可构造', () => {
    const p = runtimePath('outputs', 'some-task', 'result-01.png');
    expect(p.includes('outputs')).toBe(true);
  });

  it('向上穿越出 .runtime 的段被拒绝', () => {
    expect(() => runtimePath('outputs', '..', '..', 'etc', 'passwd')).toThrow(/非法运行时路径/);
    expect(() => runtimePath('..')).toThrow(/非法运行时路径/);
  });

  it('含 .. 的输出文件名无法通过路由守卫（UUID + 字符白名单前置拦截）', () => {
    // 与 Workspace-scoped outputs 路由的守卫条件保持一致
    const fileName = '../secrets.png';
    const safe = /^[A-Za-z0-9._/-]+$/.test(fileName) && !fileName.includes('..');
    expect(safe).toBe(false);
    expect(UUID_RE.test('..')).toBe(false);
    expect(UUID_RE.test('not-a-uuid')).toBe(false);
    expect(UUID_RE.test('11111111-2222-3333-4444-555555555555')).toBe(true);
  });
});
