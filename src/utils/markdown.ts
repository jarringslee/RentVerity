import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const parser = new MarkdownIt({ html: false, linkify: false, breaks: true })
parser.renderer.rules.image = (tokens, index) => parser.utils.escapeHtml(tokens[index]?.content ?? '[图片已禁用]')
const linkOpen = parser.renderer.rules.link_open ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options))
parser.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index]?.attrSet('target', '_blank'); tokens[index]?.attrSet('rel', 'noopener noreferrer nofollow')
  return linkOpen(tokens, index, options, env, self)
}
export function renderSafeMarkdown(text: string): string {
  return DOMPurify.sanitize(parser.render(text.slice(0, 12000)), {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 's', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a'],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class', 'start'],
    // 这些是渲染器生成的非 URL 属性，不应被下面的 URL 协议正则误删。
    ADD_URI_SAFE_ATTR: ['target', 'rel', 'start'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/(?!\/)|#)/i,
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false
  })
}
