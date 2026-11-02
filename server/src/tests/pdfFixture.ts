import fs from 'node:fs/promises';
// 只含合成英文条款的最小 PDF，避免将真实合同或个人信息放进测试。
export function makePdf(pages: string[]): Buffer {
  if (pages.some(page => /[^\x00-\x7f]/u.test(page))) return makeUnicodePdf(pages);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  pages.forEach((text, index) => {
    const lines = text.split('\n').flatMap(line => line.match(/.{1,70}(?:\s|$)|.{1,70}/g) ?? ['']);
    const height = Math.max(792, lines.length * 20 + 80);
    const escaped = lines.join('\n').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\n/g, ') Tj 0 -20 Td (');
    const stream = `BT /F1 12 Tf 50 ${height - 50} Td (${escaped}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(output)); output += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(`${output}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}

function makeUnicodePdf(pages: string[]): Buffer {
  const codes = [...new Set(pages.join('').split('').filter(c => c !== '\n').map(c => c.charCodeAt(0)))];
  const mapping = `begincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /RentVerity def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n` + codes.map(code => `1 beginbfchar\n<${code.toString(16).padStart(4,'0')}> <${code.toString(16).padStart(4,'0')}>\nendbfchar\n`).join('') + 'endcmap';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_,i)=>`${7+i*2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type0 /BaseFont /RentVerityUnicode /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 5 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /RentVerityUnicode /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 6 0 R /DW 600 >>',
    `<< /Length ${Buffer.byteLength(mapping)} >>\nstream\n${mapping}\nendstream`,
    '<< /Type /FontDescriptor /FontName /RentVerityUnicode /Flags 4 /FontBBox [0 -200 1000 1000] /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /ItalicAngle 0 >>'
  ];
  pages.forEach((text,index)=>{
    const lines=text.split('\n').flatMap(line=>line.match(/.{1,35}/gu)??['']);const height=Math.max(792,lines.length*20+80);
    const stream=`BT /F1 12 Tf 50 ${height-50} Td `+lines.map((line,i)=>`${i?'0 -20 Td ':''}<${Buffer.from(line,'utf16le').swap16().toString('hex')}> Tj`).join('\n')+' ET';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${8+index*2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  let output='%PDF-1.4\n';const offsets:number[]=[];
  objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(output));output+=`${i+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(output);
  output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('');
  return Buffer.from(output+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}

// 合法增量更新：新Catalog仍指向原Pages，另挂载大体积XML元数据流。
// 验证真实100MiB传输/落盘，不把这种资源布局冒称复杂压缩字体的CPU压力基准。
export async function writePdfFixture(filename: string, pages: string[], targetBytes?: number) {
  const original = makePdf(pages);
  if (!targetBytes || targetBytes <= original.length) { await fs.writeFile(filename, original); return; }
  const size = Number(original.toString('latin1').match(/\/Size (\d+)/)?.[1]);
  const previous = Number(original.toString('latin1').match(/startxref\n(\d+)/)?.[1]);
  const rootId = size, metadataId = size + 1, rootAt = original.length + 1;
  const catalog = `\n${rootId} 0 obj\n<< /Type /Catalog /Pages 2 0 R /Metadata ${metadataId} 0 R >>\nendobj\n`;
  const metaAt = original.length + Buffer.byteLength(catalog);
  const xmlStart = '<rentverity-fixture>\n', xmlEnd = '\n</rentverity-fixture>';
  let padding = targetBytes - original.length - 500;
  let head = '', tail = '';
  for (let n = 0; n < 5; n++) {
    const streamSize = padding + Buffer.byteLength(xmlStart + xmlEnd);
    head = catalog + `${metadataId} 0 obj\n<< /Type /Metadata /Subtype /XML /Length ${streamSize} >>\nstream\n` + xmlStart;
    const xrefAt = original.length + Buffer.byteLength(head) + padding + Buffer.byteLength(xmlEnd + '\nendstream\nendobj\n');
    tail = xmlEnd + `\nendstream\nendobj\nxref\n${rootId} 2\n${String(rootAt).padStart(10, '0')} 00000 n \n${String(metaAt).padStart(10, '0')} 00000 n \ntrailer\n<< /Size ${metadataId + 1} /Root ${rootId} 0 R /Prev ${previous} >>\nstartxref\n${xrefAt}\n%%EOF`;
    const actual = original.length + Buffer.byteLength(head + tail) + padding;
    if (actual === targetBytes) break;
    padding += targetBytes - actual;
  }
  if (padding < 1) throw new Error('Invalid fixture size');
  const handle = await fs.open(filename, 'wx');
  try {
    await handle.write(original); await handle.write(head);
    const block = Buffer.alloc(1024 * 1024, 32);
    for (let remaining = padding; remaining > 0; remaining -= Math.min(remaining, block.length)) await handle.write(block.subarray(0, Math.min(remaining, block.length)));
    await handle.write(tail);
  } finally { await handle.close(); }
  if ((await fs.stat(filename)).size !== targetBytes) throw new Error('Fixture size mismatch');
}
