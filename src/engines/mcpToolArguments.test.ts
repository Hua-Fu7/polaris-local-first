import { describe, expect, it } from 'vitest';
import { filterMcpToolArguments } from './mcpRuntimeCatalog';

describe('filterMcpToolArguments', () => {
  it('零参数工具一律发空对象（中转补的占位字段也丢掉）', () => {
    const schema = { type: 'object', properties: {}, title: 'breathArguments' };
    expect(filterMcpToolArguments(schema, { _: 'x' })).toEqual({});
    expect(filterMcpToolArguments(schema, {})).toEqual({});
    expect(filterMcpToolArguments(undefined, { _: 'x' })).toEqual({});
  });

  it('additionalProperties=false 时只保留声明过的键', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
        max_results: { type: 'integer' }
      },
      required: ['query']
    };
    expect(filterMcpToolArguments(schema, { query: '记忆', _: 'x', reason: 'y' }))
      .toEqual({ query: '记忆' });
    expect(filterMcpToolArguments(schema, { query: '记忆', max_results: 3 }))
      .toEqual({ query: '记忆', max_results: 3 });
  });

  it('其它情况原样透传，避免误伤自由字段的工具', () => {
    const schema = { type: 'object', properties: { payload: { type: 'object' } } };
    const args = { payload: { a: 1 }, extra: 'keep' };
    expect(filterMcpToolArguments(schema, args)).toBe(args);
  });
});