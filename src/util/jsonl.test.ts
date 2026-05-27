import { describe, it, expect } from 'vitest';
import { serialize, parse } from './jsonl.js';

describe('jsonl', () => {
  it('round-trips a record', () => {
    const rec = {
      ts: 1779843000123,
      level: 'info' as const,
      service: 'cernere',
      channel: 'app' as const,
      msg: 'boot complete',
      pid: 12345,
      ctx: { req_id: 'abc' },
    };
    const line = serialize(rec);
    expect(line.endsWith('\n')).toBe(true);
    const back = parse(line);
    expect(back).toEqual(rec);
  });

  it('truncates very long msg', () => {
    const big = 'x'.repeat(100 * 1024);
    const line = serialize({
      ts: 0, level: 'info', service: 'svc', channel: 'app', msg: big,
    });
    const back = parse(line)!;
    expect(back.msg.length).toBeLessThan(big.length);
    expect(back.msg).toContain('(truncated');
  });

  it('parse returns null for garbage', () => {
    expect(parse('not-json')).toBeNull();
    expect(parse('')).toBeNull();
    expect(parse('{"foo":1}')).toBeNull(); // missing required fields
  });
});
