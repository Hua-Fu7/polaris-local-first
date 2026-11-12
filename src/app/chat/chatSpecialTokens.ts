// 清掉模型/接口里漏出来的「特殊 token」。
//
// 现象：回复正文末尾冒出 `</s>`，用户在气泡里就看见了。这是 Llama 一系 tokenizer 的
// 结束标记，属于模型侧或中转层没把它截掉，跟 Polaris 无关；但**显示给我们自己看的东西
// 不该带它**，所以在这里兜住。
//
// 只清这一份明确名单，不动别的尖括号——正文里可能真的有 HTML/代码。

const SPECIAL_TOKEN_PATTERN = /<\|(?:im_end|im_start|endoftext|eot_id|end)\|>|<\/?s>|<(?:end|start)_of_turn>/gi;
const HAS_SPECIAL_TOKEN = /<\|(?:im_end|im_start|endoftext|eot_id|end)\|>|<\/?s>|<(?:end|start)_of_turn>/i;

export function stripChatSpecialTokens(text: string): string {
  if (!text || !HAS_SPECIAL_TOKEN.test(text)) return text;
  return text
    .replace(SPECIAL_TOKEN_PATTERN, '')
    // 删掉 token 后别留下多余空行或行尾空格
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}
