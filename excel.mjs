const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_XML_BYTES = 12 * 1024 * 1024;
const spreadsheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const docRelations = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRelations = 'http://schemas.openxmlformats.org/package/2006/relationships';
const contentTypes = 'http://schemas.openxmlformats.org/package/2006/content-types';

function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = offset => view.getUint16(offset, true);
  const u32 = offset => view.getUint32(offset, true);
  let footer = bytes.length - 22;
  const firstPossibleFooter = Math.max(0, footer - 65535);
  while (footer >= firstPossibleFooter) {
    if (u32(footer) === 0x06054b50 && footer + 22 + u16(footer + 20) === bytes.length) break;
    footer--;
  }
  if (footer < firstPossibleFooter || u16(footer + 4) || u16(footer + 6)) throw new Error('Файл XLSX повреждён или защищён паролем.');

  const entries = new Map();
  const directoryEnd = u32(footer + 16) + u32(footer + 12);
  let offset = u32(footer + 16);
  if (directoryEnd > footer) throw new Error('Не удалось прочитать структуру файла XLSX.');

  for (let index = 0; index < u16(footer + 10); index++) {
    if (offset + 46 > directoryEnd || u32(offset) !== 0x02014b50) throw new Error('Не удалось прочитать структуру файла XLSX.');
    const nameLength = u16(offset + 28);
    const nextEntry = offset + 46 + nameLength + u16(offset + 30) + u16(offset + 32);
    if (nextEntry > directoryEnd) throw new Error('Не удалось прочитать структуру файла XLSX.');
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.set(name, {
      flags: u16(offset + 8), method: u16(offset + 10), size: u32(offset + 24),
      compressedSize: u32(offset + 20), localOffset: u32(offset + 42),
    });
    offset = nextEntry;
  }

  return {
    has: path => entries.has(path),
    async get(path) {
      const entry = entries.get(path);
      if (!entry || entry.size > MAX_XML_BYTES || entry.flags & 1) throw new Error('Нужный лист отсутствует, слишком велик или защищён паролем.');
      const start = entry.localOffset;
      if (start + 30 > bytes.length || u32(start) !== 0x04034b50) throw new Error('Не удалось открыть лист Excel.');
      const dataStart = start + 30 + u16(start + 26) + u16(start + 28);
      const dataEnd = dataStart + entry.compressedSize;
      if (dataEnd > bytes.length) throw new Error('Файл XLSX повреждён.');
      const data = bytes.subarray(dataStart, dataEnd);
      if (entry.method === 0 && data.length === entry.size) return decoder.decode(data);
      if (entry.method !== 8) throw new Error('Формат сжатия XLSX не поддерживается.');

      const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      const chunks = [];
      let length = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > entry.size) {
          await reader.cancel();
          throw new Error('Размер содержимого XLSX превышает допустимый.');
        }
        chunks.push(value);
      }
      if (length !== entry.size) throw new Error('Файл XLSX повреждён.');
      return new Blob(chunks).text();
    },
  };
}

const elements = (node, tag) => Array.from(node.getElementsByTagNameNS('*', tag));
const first = (node, tag) => node.getElementsByTagNameNS('*', tag)[0];

async function readXml(zip, path) {
  const xml = await zip.get(path);
  if (/<!DOCTYPE/i.test(xml)) throw new Error('Содержимое листа Excel не поддерживается.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (first(doc, 'parsererror')) throw new Error('Не удалось прочитать содержимое листа Excel.');
  return doc;
}

function resolvePart(parent, target) {
  if (!target || /^[\w+.-]+:|[?#\\]/.test(target)) throw new Error('В книге обнаружена неподдерживаемая ссылка.');
  const parts = target.startsWith('/') ? [] : parent.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function textRuns(node) {
  if (!node) return '';
  return elements(node, 't')
    .filter(part => part.parentElement.localName !== 'rPh')
    .map(part => part.textContent).join('');
}

export async function readWorkbook(bytes) {
  const zip = readZip(bytes);
  const workbookPath = 'xl/workbook.xml';
  const workbook = await readXml(zip, workbookPath);
  const sheet = first(workbook, 'sheet');
  if (!sheet) throw new Error('В книге Excel нет листов.');
  const relationId = Array.from(sheet.attributes).find(attribute => attribute.localName === 'id')?.value;
  const relations = elements(await readXml(zip, 'xl/_rels/workbook.xml.rels'), 'Relationship');
  const sheetRelation = relations.find(relation => relation.getAttribute('Id') === relationId);
  if (!sheetRelation?.getAttribute('Type')?.endsWith('/worksheet') || sheetRelation.getAttribute('TargetMode') === 'External') {
    throw new Error('Первый лист книги должен быть таблицей с учениками.');
  }
  const sharedRelation = relations.find(relation => relation.getAttribute('Type')?.endsWith('/sharedStrings') && relation.getAttribute('TargetMode') !== 'External');
  const stringsPath = sharedRelation ? resolvePart(workbookPath, sharedRelation.getAttribute('Target')) : 'xl/sharedStrings.xml';
  const shared = zip.has(stringsPath) ? elements(await readXml(zip, stringsPath), 'si').map(textRuns) : [];
  const sheetPath = resolvePart(workbookPath, sheetRelation.getAttribute('Target'));
  const sheetContent = await readXml(zip, sheetPath);

  return elements(sheetContent, 'row').map((row, index) => {
    const cells = [];
    let column = 0;
    for (const cell of elements(row, 'c')) {
      const reference = cell.getAttribute('r');
      if (reference) {
        const letters = reference.match(/^[A-Z]+/i)?.[0].toUpperCase();
        if (!letters) continue;
        column = letters.length === 1 ? letters.charCodeAt(0) - 65 : 3;
      }
      if (column < 3) {
        const value = first(cell, 'v')?.textContent ?? '';
        const type = cell.getAttribute('t');
        if (type === 's') cells[column] = shared[Number(value)] ?? '';
        else if (type === 'inlineStr') cells[column] = textRuns(first(cell, 'is'));
        else if (type === 'b' || type === 'e' || type === 'd') cells[column] = '–';
        else cells[column] = value;
      }
      column++;
    }
    return { line: Number(row.getAttribute('r')) || index + 1, cells };
  });
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function binaryHeader(length, fields16, fields32) {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  for (const [offset, value] of fields16) view.setUint16(offset, value, true);
  for (const [offset, value] of fields32) view.setUint32(offset, value, true);
  return bytes;
}

function makeZip(files) {
  const local = [];
  const directory = [];
  let offset = 0;
  let directoryLength = 0;
  for (const [path, contents] of files) {
    const name = encoder.encode(path);
    const data = encoder.encode(contents);
    const crc = crc32(data);
    const header = binaryHeader(30, [[4, 20], [12, 33], [26, name.length]], [[0, 0x04034b50], [14, crc], [18, data.length], [22, data.length]]);
    const entry = binaryHeader(46, [[4, 20], [6, 20], [14, 33], [28, name.length]], [[0, 0x02014b50], [16, crc], [20, data.length], [24, data.length], [42, offset]]);
    local.push(header, name, data);
    directory.push(entry, name);
    offset += header.length + name.length + data.length;
    directoryLength += entry.length + name.length;
  }
  const end = binaryHeader(22, [[8, files.length], [10, files.length]], [[0, 0x06054b50], [12, directoryLength], [16, offset]]);
  return new Blob([...local, ...directory, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function xmlText(value) {
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function makeWorkbook(name, records, widths) {
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  const data = records.map((record, index) => {
    const row = index + 1;
    const cells = record.map((value, column) => {
      const address = String.fromCharCode(65 + column) + row;
      return typeof value === 'number'
        ? `<c r="${address}"><v>${value}</v></c>`
        : `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
    }).join('');
    return `<row r="${row}">${cells}</row>`;
  }).join('');

  return makeZip([
    ['[Content_Types].xml', `${xml}<Types xmlns="${contentTypes}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ['_rels/.rels', `${xml}<Relationships xmlns="${packageRelations}"><Relationship Id="rId1" Type="${docRelations}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${xml}<workbook xmlns="${spreadsheetNs}" xmlns:r="${docRelations}"><sheets><sheet name="${xmlText(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${xml}<Relationships xmlns="${packageRelations}"><Relationship Id="rId1" Type="${docRelations}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', `${xml}<worksheet xmlns="${spreadsheetNs}"><cols>${columns}</cols><sheetData>${data}</sheetData></worksheet>`],
  ]);
}
