// 同源标签页共享 Cookie；串行处理登录/注册/退出，避免迟到的 Set-Cookie 覆盖新会话。
// 本地 Chromium 支持 Web Locks；不支持时至少保证当前标签页串行。
let queue: Promise<unknown> = Promise.resolve()
let revision = 0
let active = false
export const getAuthRevision = () => revision
export const isAuthMutating = () => active

export async function withAuthMutation<T>(action: () => Promise<T>): Promise<T> {
  const run = async () => {
    active = true; revision++
    try { return await action() }
    finally { active = false; revision++ }
  }
  if (typeof navigator !== 'undefined' && navigator.locks) return await navigator.locks.request('rentverity_auth_cookie', run)
  const next = queue.then(run, run)
  queue = next.catch(() => {})
  return next
}
