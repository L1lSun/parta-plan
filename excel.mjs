const encoder = new TextEncoder();
const spreadsheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const docRelations = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRelations = 'http://schemas.openxmlformats.org/package/2006/relationships';
const contentTypes = 'http://schemas.openxmlformats.org/package/2006/content-types';

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
