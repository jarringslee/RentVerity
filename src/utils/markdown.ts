import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const parser = new MarkdownIt({ html: false, linkify: false, breaks: true })
parser.renderer.rules.image = (tokens, index) => parser.utils.escapeHtml(tokens[index]?.content ?? '[图片已禁用]')
// 模型不能创建导航入口。Markdown链接仅保留标签和纯文本目标，真实详情按钮由房源卡片创建。
parser.renderer.rules.link_open = () => ''
parser.renderer.rules.link_close = (tokens, index) => {
  let depth = 1
  for (let i = index - 1; i >= 0; i--) {
    if (tokens[i]?.type === 'link_close') depth++
    if (tokens[i]?.type === 'link_open' && --depth === 0) {
      const href = tokens[i]?.attrGet('href') ?? ''
      return href ? `（${parser.utils.escapeHtml(String(href))}）` : ''
    }
  }
  return ''
}
export function renderSafeMarkdown(text: string): string {
  return DOMPurify.sanitize(parser.render(text.slice(0, 12000)), {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 's', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['class', 'start'],
    ADD_URI_SAFE_ATTR: ['start'],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false
  })
}
