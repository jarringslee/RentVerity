// 只检查 Git 路径，不读取/打印凭证内容，也不修改索引或历史。
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const unsafe = tracked.filter(file => /(^|\/)\.env($|\.)/.test(file) && !file.endsWith('.env.example') || /^server\/uploads\//.test(file) && !file.endsWith('/.gitkeep') || /\.(pem|p12|pfx|key)$/i.test(file));
if (unsafe.length) {
  console.error('以下本地配置/用户文件仍受 Git 跟踪（不会读取其内容）：\n' + unsafe.map(file => `- ${file}`).join('\n'));
  console.error('请手动 git rm --cached -- <精确路径>，保留本地文件后提交；已有历史若含真实凭证，需要轮换。脚本不会改写历史。');
  process.exitCode = 1;
} else console.log('跟踪文件路径检查通过；此检查不等于 Git 历史或全部内容的秘密扫描。');
