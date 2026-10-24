// localhost 与 127.0.0.1 的 Cookie 不共享，本地默认跟随前端所用主机。
const localHost = typeof location !== 'undefined' && location.hostname === '127.0.0.1' ? '127.0.0.1' : 'localhost'
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || `http://${localHost}:3001`
export const SESSION_HEADER = 'X-RentVerity-Session'
