import Busboy from 'busboy';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request } from 'express';
import { AppError } from '../utils/AppError';
import { validatePdfMetadata, validatePdfFile } from './pdf';

export async function receivePdf(req: Request, incoming: string, target: string, declared: number, signal: AbortSignal, progress: (bytes: number) => void): Promise<string> {
  let received = 0, wire = 0, filename = '', files = 0, finished = false;
  const writes: Promise<void>[] = [];
  const parser = Busboy({ headers: req.headers, defParamCharset: 'utf8', limits: { fileSize: declared + 1, files: 1, fields: 0, parts: 2, headerPairs: 30, fieldNameSize: 100 } });
  const local = new AbortController(), combined = AbortSignal.any([signal, local.signal]);
  let failure: Error | undefined;
  const fail = (error: Error) => {
    if (failure) return;
    failure = error;
    // Busboy的limit/file回调仍在同步修改当前流；在下一微任务销毁，避免重入破坏其内部状态。
    queueMicrotask(() => { local.abort(error); if (!parser.destroyed) parser.destroy(error); });
  };
  const wireCount = (data: Buffer) => { wire += data.length; if (wire > declared + 65536) fail(new AppError(413, 'FILE_SIZE', '接收数据超过预留大小。')); };
  const aborted = () => fail(new AppError(400, 'UPLOAD_INCOMPLETE', '上传未完整结束，文件未进入解析。'));
  const cancelled = () => fail(new AppError(499, 'REQUEST_CANCELLED', '上传已停止。'));
  req.on('data', wireCount); req.once('aborted', aborted); signal.addEventListener('abort', cancelled, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      parser.on('error', _error => reject(failure ?? new AppError(400, 'UPLOAD_INCOMPLETE', 'multipart 上传不完整或格式无效。')));
      parser.on('filesLimit', () => fail(new AppError(400, 'FILE_COUNT', '每次只能上传一个 file 字段。')));
      parser.on('fieldsLimit', () => fail(new AppError(400, 'FILE_FIELDS', '不允许额外表单字段。')));
      parser.on('partsLimit', () => fail(new AppError(400, 'FILE_COUNT', 'multipart 部分数量超限。')));
      parser.on('file', (name, stream, info) => {
        stream.on('error', () => {}); // 元数据拒绝发生在pipeline建立前，也必须接住销毁时的流错误。
        try {
          if (name !== 'file' || ++files !== 1) throw new AppError(400, 'FILE_REQUIRED', '请上传一个 file 字段。');
          validatePdfMetadata({ originalname: info.filename, mimetype: info.mimeType });
          filename = info.filename.replace(/^.*[\\/]/, '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180);
          let header = Buffer.alloc(0);
          const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
            received += chunk.length; progress(received);
            if (received > declared) { callback(new AppError(413, 'FILE_SIZE', '实际文件超过接收前预留大小。')); return; }
            if (header.length < 16) header = Buffer.concat([header, chunk.subarray(0, 16 - header.length)]);
            callback(null, chunk);
          } });
          stream.once('limit', () => fail(new AppError(413, 'FILE_SIZE', '文件大小超限。')));
          const writing = pipeline(stream, counter, fs.createWriteStream(incoming, { flags: 'wx', mode: 0o600 }), { signal: combined }).then(() => {
            if (stream.truncated || received !== declared) throw new AppError(400, 'UPLOAD_SIZE_MISMATCH', '实际文件大小与声明不符，未进入解析。');
            validatePdfFile({ buffer: header, originalname: filename, mimetype: info.mimeType });
          });
          writes.push(writing); void writing.catch(error => fail(error instanceof AppError ? error : new AppError(507, 'UPLOAD_WRITE', '临时文件写入失败。')));
        } catch (error) { stream.resume(); fail(error as Error); }
      });
      parser.once('close', () => { finished = true; resolve(); });
      if (signal.aborted) cancelled(); else req.pipe(parser);
    });
    await Promise.all(writes);
    if (failure) throw failure;
    if (!finished || !req.complete || files !== 1 || !received) throw new AppError(400, 'UPLOAD_INCOMPLETE', '未收到完整 PDF 和 multipart 结束边界。');
    await fsp.rename(incoming, target); // 只有完整接收/落盘之后才出现可解析文件名。
    return filename;
  } catch (error) {
    throw failure ?? error;
  } finally {
    req.unpipe(parser); req.off('data', wireCount); req.off('aborted', aborted); signal.removeEventListener('abort', cancelled);
    if (!parser.destroyed) parser.destroy();
    await Promise.allSettled(writes);
  }
}
