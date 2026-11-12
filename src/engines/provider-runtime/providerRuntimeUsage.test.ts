import { describe, expect, it } from 'vitest';
import { parseOpenAiCompatibleUsage } from './providerRuntimeUsage';

describe('parseOpenAiCompatibleUsage', () => {
  it('reads OpenRouter cache writes and reported zero reads from chat-completions usage', () => {
    expect(parseOpenAiCompatibleUsage({
      prompt_tokens: 4096,
      completion_tokens: 64,
      total_tokens: 4160,
      prompt_tokens_details: {
        cached_tokens: 0,
        cache_write_tokens: 4096
      }
    })).toEqual({
      totalTokens: 4160,
      inputTokens: 4096,
      outputTokens: 64,
      cachedInputTokens: 0,
      cacheMissInputTokens: 4096,
      cacheCreationInputTokens: 4096
    });
  });

  it('reads cache usage from Responses input token details', () => {
    expect(parseOpenAiCompatibleUsage({
      input_tokens: 5000,
      output_tokens: 80,
      input_tokens_details: {
        cached_tokens: 4200,
        cache_write_tokens: 0
      }
    })).toEqual({
      inputTokens: 5000,
      outputTokens: 80,
      cachedInputTokens: 4200,
      cacheMissInputTokens: 800,
      cacheCreationInputTokens: 0
    });
  });

  it('Anthropic 风格：input_tokens 不含缓存，总数要加回去', () => {
    const usage = parseOpenAiCompatibleUsage({
      input_tokens: 2684,
      output_tokens: 78,
      cache_read_input_tokens: 50751,
      cache_creation_input_tokens: 28,
      total_tokens: 53541
    });

    // 以前的算法：miss = 2684 - 50751 → 负数被截成 0 → 命中率恒等于 100%
    expect(usage?.cacheMissInputTokens).toBe(2684);
    expect(usage?.cachedInputTokens).toBe(50751);
    expect(usage?.inputTokens).toBe(2684 + 50751 + 28);
  });

  it('Anthropic 风格但没有任何缓存读写时，仍算作未命中', () => {
    const usage = parseOpenAiCompatibleUsage({
      input_tokens: 1200,
      output_tokens: 40,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0
    });

    expect(usage?.inputTokens).toBe(1200);
    expect(usage?.cacheMissInputTokens).toBe(1200);
    expect(usage?.cachedInputTokens).toBe(0);
  });
});
