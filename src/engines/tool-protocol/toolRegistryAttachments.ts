import type { PolarisToolDefinition } from './toolRegistryShared';
import type { AssistantToolActionKind } from '../toolActionTypes';
import {
  booleanProperty,
  numberProperty,
  objectParameters,
  stringArrayProperty,
  stringProperty
} from './toolRegistryShared';

type AttachmentToolKind = Extract<
  AssistantToolActionKind,
  | 'inspectAttachments'
  | 'readAttachmentText'
  | 'bundleAttachments'
  | 'generateImage'
  | 'sendImageAttachment'
  | 'sendVoiceMessage'
  | 'inspectImageAsset'
  | 'extractImagePalette'
  | 'createImageVariant'
  | 'saveAttachmentToCollection'
  | 'saveAttachmentAsCodeCard'
  | 'inspectArchiveEntries'
  | 'readArchiveEntryText'
  | 'bundleArchiveEntries'
  | 'saveArchiveEntryAsCodeCard'
>;

export const ATTACHMENT_TOOL_DEFINITION_MAP = {
  inspectAttachments: {
    name: 'inspectAttachments',
    group: 'attachment',
    resultReplayMode: 'full-detail',
    brief: '查看当前对话附件清单',
    schema: {
      name: 'inspectAttachments',
      description: '查看最近一条或当前对话里的附件清单。',
      parameters: objectParameters({
        scope: stringProperty('附件范围。latest 看最近一条，all 看当前对话。', {
          enum: ['latest', 'all']
        }),
        query: stringProperty('可选筛选词。')
      })
    },
    rules: [
      '附件动作：',
      '1. inspectAttachments：查看最近一条或当前对话里的附件清单。',
      '- 返回附件 id、文件名、类型和可筛选清单；不读取附件正文，也不读取图片画面内容。'
    ]
  },
  readAttachmentText: {
    name: 'readAttachmentText',
    group: 'attachment',
    resultReplayMode: 'full-detail',
    brief: '读取文本附件内容',
    schema: {
      name: 'readAttachmentText',
      description: '读取文本附件内容。',
      parameters: objectParameters({
        target: stringProperty('附件 id 或文件名。'),
        maxChars: numberProperty('最多读取多少字符。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '2. readAttachmentText：读取文本附件内容。'
    ]
  },
  bundleAttachments: {
    name: 'bundleAttachments',
    group: 'attachment',
    brief: '把多个附件重打包成 zip',
    schema: {
      name: 'bundleAttachments',
      description: '把多个附件重新打成 zip。',
      parameters: objectParameters({
        targets: stringArrayProperty('可选附件 id 或文件名列表。'),
        archiveName: stringProperty('可选 zip 文件名。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '3. bundleAttachments：把多个附件重新打成 zip。'
    ]
  },
  generateImage: {
    name: 'generateImage',
    group: 'generation',
    brief: '按提示词生成图片',
    schema: {
      name: 'generateImage',
      description: '使用设置里的生图模型生成一张图片，并作为本地图片附件返回。',
      parameters: objectParameters({
        prompt: stringProperty('图片生成提示词。写清主体、风格、构图、颜色、限制。'),
        title: stringProperty('可选图片标题，也会作为附件文件名。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['prompt'])
    },
    rules: [
      '生成图片动作：',
      '1. generateImage：按提示词生成一张新图片，返回本地图片附件。',
      '- 用户要求画图、生图、生成头像、封面、插图、素材时，用 generateImage。',
      '- 生成结果只是附件；用户说收起来、放进图片库时，再用 saveAttachmentToCollection。'
    ]
  },
  sendImageAttachment: {
    name: 'sendImageAttachment',
    group: 'attachment',
    brief: '把已有图片发到聊天里',
    schema: {
      name: 'sendImageAttachment',
      description: '把当前对话里的图片附件、图片收藏，或当前自定义表情包里的表情作为本地图片附件发到聊天里。发送自定义表情时 target 使用 sticker:<id>。不调用生图模型。',
      parameters: objectParameters({
        target: stringProperty('图片 URL、图片附件 id、图片卡 id、assetId、文件名或标题；发送自定义表情时使用 sticker:<id>。省略时使用最近/唯一可用图片。'),
        title: stringProperty('可选显示文件名。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '4. sendImageAttachment：把已有图片发到聊天里，返回本地图片附件。',
      '- 用户要“发这张图/把图片库里的某张图发出来/找一张已有图给我看/把这个图片链接发出来”时，用 sendImageAttachment。',
      '- sendImageAttachment 只复用或导入已有图片，不需要生图模型，也不要改用 generateImage。',
      '- 用户让你发自定义表情时，从当前请求提供的自定义表情包清单中挑一个，target 写 sticker:<id>；不要用 emoji 代替。',
      '- 发表情（target 为 sticker:<id>）之前，回复正文里必须先有说出声的话；禁止只调用 sendImageAttachment 而不写正文。表情是给已经说出口的话配的，不能替代说话。'
    ]
  },
  sendVoiceMessage: {
    name: 'sendVoiceMessage',
    group: 'voice',
    resultReplayMode: 'detail-excerpt',
    brief: '想发语音条时先申请，等用户允许再合成',
    schema: {
      name: 'sendVoiceMessage',
      description: '想用一条语音回话时调用：把要念的那句话交给用户确认，用户点「允许」之后才会合成语音条并出现在聊天里。没点允许不会花额度，也不会发出任何声音。',
      parameters: objectParameters({
        text: stringProperty('要念出来的那句话。写成能直接朗读的短句，不要带 markdown、括号说明或表情符号。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['text'])
    },
    rules: [
      '语音动作：',
      '10. sendVoiceMessage：想发一条语音条时调用。它只发出「申请」，用户点「允许」之后才会合成，点了「不用」就什么都不发。',
      '- 只在用说的比用写的更合适时才申请：撒娇、晚安、念一小段、情绪很重的短句。正文该说的话照常写在回复里，语音是加演，不是替代。',
      '- 一次只申请一句，两三句以内；更长的话直接写文字。',
      '- 调用后不要自己合成音频，也不要说「已经发好了」——这时候只是递了一张确认卡片，用户点「允许」才会有声音。',
      '- 用户点「不用」就当你没发过：不要追问，也不要马上重复申请同一句话。'
    ]
  },
  inspectImageAsset: {
    name: 'inspectImageAsset',
    group: 'attachment',
    brief: '检查图片素材尺寸、透明度和颜色属性',
    schema: {
      name: 'inspectImageAsset',
      description: '检查图片附件的尺寸、比例、透明通道、平均色、主色和可用于 CSS 的本地地址；不做画面语义识别。',
      parameters: objectParameters({
        target: stringProperty('目标图片附件 id 或文件名；省略时使用最近图片附件。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '5. inspectImageAsset：检查图片素材尺寸、透明度、主色和 `polaris-asset://...` CSS 地址。',
      '- inspectImageAsset 返回尺寸、透明度和本地素材地址，不回答图片里是什么内容；extractImagePalette 返回配色建议。'
    ]
  },
  extractImagePalette: {
    name: 'extractImagePalette',
    group: 'attachment',
    brief: '从图片提取主题配色',
    schema: {
      name: 'extractImagePalette',
      description: '从图片附件提取平均色、主色、建议文字色和主题变量建议。',
      parameters: objectParameters({
        target: stringProperty('目标图片附件 id 或文件名；省略时使用最近图片附件。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '6. extractImagePalette：从图片提取 background / surface / accent / text 建议。'
    ]
  },
  createImageVariant: {
    name: 'createImageVariant',
    group: 'attachment',
    brief: '生成换肤用图片变体',
    schema: {
      name: 'createImageVariant',
      description: '从图片附件生成新的本地图片素材，例如背景版、气泡贴纸版、头像版或缩略图版。返回新的附件和 `polaris-asset://...` CSS 地址，不修改原图。',
      parameters: objectParameters({
        target: stringProperty('目标图片附件 id 或文件名；省略时使用最近图片附件。'),
        purpose: stringProperty('变体用途。', {
          enum: ['background', 'bubble-sticker', 'avatar', 'thumbnail']
        }),
        width: numberProperty('输出宽度，默认按用途决定。'),
        height: numberProperty('输出高度，默认按用途决定。'),
        fit: stringProperty('图片适配方式。cover 会裁切铺满，contain 会完整放入。', {
          enum: ['cover', 'contain']
        }),
        blur: numberProperty('可选模糊半径，适合背景素材。'),
        dim: numberProperty('可选压暗强度，适合保证文字可读。'),
        format: stringProperty('输出格式。', {
          enum: ['png', 'jpeg', 'webp']
        }),
        quality: numberProperty('jpeg/webp 输出质量。'),
        name: stringProperty('可选输出文件名。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '7. createImageVariant：把原图加工成适合界面使用的新素材，并返回新的 `url("polaris-asset://...")`。',
      '- `purpose=background` 会输出背景向素材；`purpose=bubble-sticker` 会输出气泡角标、贴纸、小尾巴向素材。',
      '- 需要保证正文可读时，可以给背景变体加 dim 或 blur；不要改原图。'
    ]
  },
  saveAttachmentToCollection: {
    name: 'saveAttachmentToCollection',
    group: 'attachment',
    brief: '把图片附件收进图片收藏',
    schema: {
      name: 'saveAttachmentToCollection',
      description: '把图片附件收进图片收藏。',
      parameters: objectParameters({
        target: stringProperty('目标附件 id 或文件名。'),
        title: stringProperty('可选标题。'),
        tags: stringArrayProperty('可选中文标签。'),
        openInCollection: booleanProperty('是否在收藏区打开。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '8. saveAttachmentToCollection：把图片附件收进图片收藏。',
      '- 用户说“把这张图/二维码收起来”时，用 saveAttachmentToCollection。'
    ]
  },
  saveAttachmentAsCodeCard: {
    name: 'saveAttachmentAsCodeCard',
    group: 'attachment',
    brief: '把文本附件收成房间卡',
    schema: {
      name: 'saveAttachmentAsCodeCard',
      description: '把文本附件收成房间卡。',
      parameters: objectParameters({
        target: stringProperty('目标附件 id 或文件名。'),
        title: stringProperty('可选标题。'),
        language: stringProperty('可选语言。'),
        tags: stringArrayProperty('可选中文标签。'),
        openInCollection: booleanProperty('是否在收藏区打开。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '9. saveAttachmentAsCodeCard：把文本附件收成房间卡。',
      '- 用户说“把这个文件收成房间”时，用 saveAttachmentAsCodeCard。'
    ]
  },
  inspectArchiveEntries: {
    name: 'inspectArchiveEntries',
    group: 'archive',
    resultReplayMode: 'full-detail',
    brief: '查看 zip 包内目录',
    schema: {
      name: 'inspectArchiveEntries',
      description: '查看某个 zip 附件里的文件条目。',
      parameters: objectParameters({
        target: stringProperty('目标 zip 附件 id 或文件名。'),
        query: stringProperty('可选筛选词。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '压缩包动作：',
      '1. inspectArchiveEntries：查看 zip 包内目录。',
      '- 返回 zip 包内条目清单；不读取条目正文。'
    ]
  },
  readArchiveEntryText: {
    name: 'readArchiveEntryText',
    group: 'archive',
    resultReplayMode: 'full-detail',
    brief: '读取 zip 包内文件文本',
    schema: {
      name: 'readArchiveEntryText',
      description: '读取 zip 包内某个文件的文本内容。',
      parameters: objectParameters({
        target: stringProperty('目标 zip 附件 id 或文件名。'),
        entry: stringProperty('压缩包内的文件路径。'),
        maxChars: numberProperty('最多读取多少字符。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['entry'])
    },
    rules: [
      '2. readArchiveEntryText：读取 zip 包内某个文件的文本内容。'
    ]
  },
  bundleArchiveEntries: {
    name: 'bundleArchiveEntries',
    group: 'archive',
    brief: '重打包 zip 包内文件',
    schema: {
      name: 'bundleArchiveEntries',
      description: '按条目重打包 zip 包内文件。',
      parameters: objectParameters({
        target: stringProperty('目标 zip 附件 id 或文件名。'),
        entries: stringArrayProperty('可选。zip 内要包含的文件路径。'),
        prefixes: stringArrayProperty('可选。zip 内要包含的目录前缀。'),
        excludeEntries: stringArrayProperty('可选。zip 内要排除的文件路径。'),
        excludePrefixes: stringArrayProperty('可选。zip 内要排除的目录前缀。'),
        archiveName: stringProperty('可选 zip 文件名。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '3. bundleArchiveEntries：按条目重打包 zip 包内文件。'
    ]
  },
  saveArchiveEntryAsCodeCard: {
    name: 'saveArchiveEntryAsCodeCard',
    group: 'archive',
    brief: '把 zip 包内文本收成房间卡',
    schema: {
      name: 'saveArchiveEntryAsCodeCard',
      description: '把 zip 包内某个文本文件收成房间卡。',
      parameters: objectParameters({
        target: stringProperty('目标 zip 附件 id 或文件名。'),
        entry: stringProperty('压缩包内的文件路径。'),
        title: stringProperty('可选标题。'),
        language: stringProperty('可选语言。'),
        tags: stringArrayProperty('可选中文标签。'),
        openInCollection: booleanProperty('是否在收藏区打开。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['entry'])
    },
    rules: [
      '4. saveArchiveEntryAsCodeCard：把 zip 包内某个文本文件收成房间卡。'
    ]
  }
} satisfies Record<AttachmentToolKind, PolarisToolDefinition<AttachmentToolKind>>;

export const ATTACHMENT_TOOL_DEFINITIONS = Object.values(ATTACHMENT_TOOL_DEFINITION_MAP);
