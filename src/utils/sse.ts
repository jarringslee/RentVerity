/** 一次网络读取可以含半个/多个事件；CRLF、注释、跨 chunk 的 data 都要保留。 */
export class SseFrames {
  private pending = ''
  private event = 'message'
  private data: string[] = []
  private dataSize = 0
  feed(text: string): { event: string; data: string }[] {
    this.pending += text
    if (this.pending.length > 256000) throw new Error('流事件超过大小限制。')
    const frames: { event: string; data: string }[] = []
    while (true) {
      const end = this.pending.indexOf('\n'); if (end < 0) break
      const line = this.pending.slice(0, end).replace(/\r$/, ''); this.pending = this.pending.slice(end + 1)
      if (!line) {
        if (this.data.length) frames.push({ event: this.event, data: this.data.join('\n') })
        this.event = 'message'; this.data = []; this.dataSize = 0
      } else if (line.startsWith('event:')) this.event = line.slice(6).trim()
      else if (line.startsWith('data:')) { const value = line.slice(5).replace(/^ /, ''); this.data.push(value); this.dataSize += value.length }
      if (this.dataSize > 256000) throw new Error('流事件超过大小限制。')
    }
    return frames
  }
}
