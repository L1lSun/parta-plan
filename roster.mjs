import { MAX_STUDENTS } from './seating.mjs';

export function readDelimited(text) {
  const firstLine = text.split(/\r\n|\n|\r/).find(line => line.trim()) ?? '';
  const unquoted = firstLine.replace(/"(?:[^"]|"")*"/g, '');
  const delimiter = unquoted.includes(';') ? ';' : unquoted.includes('\t') ? '\t' : ',';
  const records = [];
  let cells = [];
  let value = '';
  let quoted = false;
  let line = 1;
  let startLine = 1;

  function finishRecord() {
    cells.push(value);
    records.push({ line: startLine, cells });
    cells = [];
    value = '';
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        value += char;
        i++;
      } else if (char === '"') {
        quoted = false;
      } else if (char === '\r' || char === '\n') {
        if (char === '\r' && text[i + 1] === '\n') i++;
        value += '\n';
        line++;
      } else {
        value += char;
      }
    } else if (char === '"' && !value.trim()) {
      quoted = true;
      value = '';
    } else if (char === delimiter) {
      cells.push(value);
      value = '';
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      finishRecord();
      startLine = ++line;
    } else {
      value += char;
    }
  }
  if (quoted) throw new Error(`Строка ${startLine}: не закрыты кавычки в CSV.`);
  if (value || cells.length) finishRecord();
  return records;
}

export function decodeCsv(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1251').decode(bytes);
  }
}

function decimal(cell, unit) {
  const normalized = cell.trim().replace(unit, '').trim().replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return NaN;
  return Number(normalized);
}

export function validateRoster(records) {
  const students = [];
  const errors = [];
  let first = true;

  for (const { line, cells } of records) {
    const [name = '', heightText = '', visionText = ''] = cells.map(cell => String(cell ?? '').trim());
    if (!name && !heightText && !visionText) continue;

    const nameLabel = name.toLowerCase().replace(/[\s.]/g, '');
    const header = /^(фио(?:ученика)?|фамилияимя(?:отчество)?|ученик|имя)$/.test(nameLabel)
      && /^рост(?:\b|[\s,(]|$)/i.test(heightText) && /зрение|острот/i.test(visionText);
    if (first && header) {
      first = false;
      continue;
    }
    first = false;

    const height = decimal(heightText, /\s*см$/i);
    const percent = visionText.endsWith('%');
    const vision = decimal(visionText, /\s*%$/) / (percent ? 100 : 1);
    const issues = [];
    if (!name || name.length > 150 || !/\p{L}/u.test(name)) issues.push('укажите ФИО длиной до 150 символов');
    if (!(height > 0 && height <= 300)) issues.push('укажите рост в сантиметрах (число от 0 до 300, больше нуля)');
    if (!(vision >= 0 && vision <= 3)) issues.push('укажите остроту зрения от 0 до 3, например 0,7');

    if (issues.length) errors.push(`Строка ${line}: ${issues.join('; ')}.`);
    else students.push({ name: name.replace(/\s+/g, ' '), height, vision });
  }

  if (students.length > MAX_STUDENTS) errors.unshift(`В списке больше ${MAX_STUDENTS} учеников. Разделите его на несколько классов.`);
  if (!students.length && !errors.length) errors.push('Список пуст. Заполните хотя бы одну строку после заголовков.');
  return { students, errors };
}
