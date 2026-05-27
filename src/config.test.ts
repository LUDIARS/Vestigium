import { describe, it, expect, afterEach } from 'vitest';
import { resolveConfig } from './config.js';

const originalEnv = process.env.VESTIGIUM_LOGS_DIR;
afterEach(() => {
  if (originalEnv === undefined) delete process.env.VESTIGIUM_LOGS_DIR;
  else process.env.VESTIGIUM_LOGS_DIR = originalEnv;
});

describe('config', () => {
  it('applies defaults', () => {
    const c = resolveConfig({ serviceCode: 'cernere' });
    expect(c.retentionDays).toBe(14);
    expect(c.captureConsole).toBe(false);
    expect(c.pinoTransport).toBe(false);
    expect(c.sweepIntervalMs).toBeGreaterThan(0);
  });

  it('rejects invalid service code', () => {
    expect(() => resolveConfig({ serviceCode: 'BAD!' })).toThrow();
    expect(() => resolveConfig({ serviceCode: '' })).toThrow();
  });

  it('lowercases service code', () => {
    const c = resolveConfig({ serviceCode: 'CERNERE' });
    expect(c.serviceCode).toBe('cernere');
  });

  it('env VESTIGIUM_LOGS_DIR is honored when logsDir not provided', () => {
    process.env.VESTIGIUM_LOGS_DIR = '/tmp/vestigium-env';
    const c = resolveConfig({ serviceCode: 'svc' });
    expect(c.resolvedLogsDir).toMatch(/vestigium-env/);
  });

  it('explicit logsDir overrides env', () => {
    process.env.VESTIGIUM_LOGS_DIR = '/tmp/vestigium-env';
    const c = resolveConfig({ serviceCode: 'svc', logsDir: '/tmp/explicit' });
    expect(c.resolvedLogsDir).toMatch(/explicit/);
  });
});
