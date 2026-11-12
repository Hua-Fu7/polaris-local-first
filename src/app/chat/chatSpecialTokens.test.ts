import { describe, expect, it } from 'vitest';
import { stripChatSpecialTokens } from './chatSpecialTokens';

describe('stripChatSpecialTokens', () => {
  it('去掉结尾漏出来的 </s>', () => {
    expect(stripChatSpecialTokens('你今天在做什么?</s>')).toBe('你今天在做什么?');
  });

  it('去掉常见的 chat template 标记', () => {
    expect(stripChatSpecialTokens('好的<|im_end|>')).toBe('好的');
    expect(stripChatSpecialTokens('<|im_start|>assistant\n好的')).toBe('assistant\n好的');
    expect(stripChatSpecialTokens('收到<|endoftext|>')).toBe('收到');
    expect(stripChatSpecialTokens('嗯<s>好</s>')).toBe('嗯好');
  });

  it('删掉 token 后不留空行和行尾空格', () => {
    expect(stripChatSpecialTokens('第一行  \n</s>\n\n\n第二行')).toBe('第一行\n\n第二行');
  });

  it('正文里正常的尖括号不动', () => {
    const text = '用 <div> 包一层，关闭写成 </div>。';
    expect(stripChatSpecialTokens(text)).toBe(text);
    expect(stripChatSpecialTokens('if (a < b) return a;')).toBe('if (a < b) return a;');
  });
});
