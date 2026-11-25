function decimal(input, unit) {
  const normalized = input.trim().replace(unit, '').trim().replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return NaN;
  return Number(normalized);
}

export function validateStudent(nameText, heightText, visionText) {
  const name = nameText.trim().replace(/\s+/g, ' ');
  const height = decimal(heightText, /\s*см$/i);
  const vision = decimal(visionText, /\s*%$/) / (visionText.trim().endsWith('%') ? 100 : 1);
  const errors = {};

  if (!name || name.length > 150 || !/\p{L}/u.test(name)) {
    errors.name = 'Введите ФИО ученика.';
  }
  if (!(height > 0 && height <= 300)) {
    errors.height = 'Укажите рост в сантиметрах, например 152.';
  }
  if (!(vision >= 0 && vision <= 3)) {
    errors.vision = 'Укажите остроту зрения от 0 до 3, например 0,8.';
  }

  const student = Object.keys(errors).length ? null : { name, height, vision };
  return { student, errors };
}
