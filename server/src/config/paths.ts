import path from 'path';

/** 编译后位于 server/dist，上传目录在 server/uploads */
export const UPLOADS_ROOT = path.join(__dirname, '../../uploads');
export const AVATARS_DIR = path.join(UPLOADS_ROOT, 'avatars');
