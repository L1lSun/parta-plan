import { makeWorkbook, readWorkbook } from './excel.mjs';
import { decodeCsv, readDelimited, validateRoster } from './roster.mjs';
import { assignStudents, MAX_DESKS, MAX_ROWS, seatsFor } from './seating.mjs';

const byId = id => document.getElementById(id);
const fileInput = byId('file-input');
const dropzone = byId('dropzone');
const uploadLabel = byId('upload-label');
const fileState = byId('file-state');
const fileName = byId('file-name');
const importError = byId('import-error');
const rowsInput = byId('row-count');
const desksInput = byId('desk-count');
const capacity = byId('capacity');
const roomError = byId('room-error');
const calculateButton = byId('calculate-button');
const status = byId('plan-status');
const exportButton = byId('export-button');
const printButton = byId('print-button');
const seatMap = byId('seat-map');

const sample = [
  ['Андреева Мария', 145, 1], ['Белов Артём', 164, 0.4], ['Власова София', 151, 0.9],
  ['Громов Максим', 173, 1], ['Денисова Анна', 156, 0.7], ['Егоров Михаил', 150, 0.6],
  ['Жукова Полина', 147, 1], ['Захаров Иван', 158, 0.8], ['Ильина Ева', 163, 1],
  ['Ким Даниил', 160, 0.5], ['Лебедева Алиса', 149, 1], ['Морозов Никита', 169, 1],
  ['Николаева Дарья', 159, 0.9], ['Орлов Александр', 155, 0.6], ['Павлова Юлия', 153, 1],
  ['Романов Лев', 170, 1], ['Соколова Елена', 161, 0.8], ['Тихонов Матвей', 168, 0.9],
  ['Фёдорова Вера', 166, 1], ['Чернов Кирилл', 174, 1.2],
].map(([name, height, vision]) => ({ name, height, vision }));

let roster = [];
let plan = null;
let importGeneration = 0;
let importing = false;

const plural = new Intl.PluralRules('ru');
function countLabel(count, forms) {
  return `${count} ${forms[plural.select(count)] ?? forms.many}`;
}
const places = count => countLabel(count, { one: 'место', few: 'места', many: 'мест' });
const pupils = count => countLabel(count, { one: 'ученик', few: 'ученика', many: 'учеников' });

function populate(select, maximum, initial) {
  for (let number = 1; number <= maximum; number++) {
    select.add(new Option(String(number), String(number), number === initial, number === initial));
  }
}

function node(tag, className, content) {
  const element = document.createElement(tag);
  element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function renderSeats(seats, desks) {
  const fragment = document.createDocumentFragment();
  let row;
  let desk;

  for (const seat of seats) {
    if (seat.number === 1) {
      const rowContainer = node('div', 'seat-row');
      row = node('div', 'desks');
      rowContainer.append(node('span', 'row-label', `Ряд ${seat.row}`), row);
      fragment.append(rowContainer);
    }
    if (seat.side === 0) {
      desk = node('div', 'desk');
      desk.setAttribute('role', 'group');
      desk.setAttribute('aria-label', `Ряд ${seat.row}, парта ${seat.desk} из ${desks}`);
      row.append(desk);
    }
    const seatElement = node('div', seat.student ? 'seat occupied' : 'seat');
    if (seat.student) {
      seatElement.append(node('span', 'student-name', seat.student.name));
    } else {
      const label = node('span', 'number', String(seat.number));
      label.setAttribute('aria-label', `Место ${seat.number} свободно`);
      seatElement.append(label);
    }
    desk.append(seatElement);
  }
  seatMap.replaceChildren(fragment);
}

function render() {
  const rows = Number(rowsInput.value);
  const desks = Number(desksInput.value);
  const total = rows * desks * 2;
  const shortfall = Math.max(0, roster.length - total);
  capacity.textContent = `Вместимость: ${places(total)}`;
  roomError.hidden = !shortfall;
  roomError.textContent = shortfall ? `Нужно ещё ${places(shortfall)}. Добавьте ряды или парты.` : '';
  calculateButton.disabled = !roster.length || Boolean(shortfall) || importing;
  exportButton.disabled = !plan;
  printButton.disabled = !plan;

  if (plan) status.textContent = `${pupils(roster.length)} · свободно ${places(total - roster.length)}`;
  else if (roster.length) status.textContent = `В списке ${pupils(roster.length)}. Распределите места.`;
  else status.textContent = 'Загрузите список, чтобы распределить места';

  renderSeats(plan ?? seatsFor(rows, desks), desks);
}

function showErrors(errors = []) {
  importError.hidden = !errors.length;
  importError.replaceChildren();
  if (!errors.length) return;
  if (errors.length === 1) {
    importError.textContent = errors[0];
    return;
  }

  importError.append(node('p', '', 'Исправьте ошибки в файле и загрузите его снова.'));
  const list = node('ul', '');
  for (const error of errors.slice(0, 5)) list.append(node('li', '', error));
  if (errors.length > 5) list.append(node('li', '', `Других ошибок: ${errors.length - 5}`));
  importError.append(list);
}

function setImporting(value) {
  importing = value;
  dropzone.setAttribute('aria-busy', String(value));
  uploadLabel.textContent = value ? 'Читаем файл…' : roster.length ? 'Заменить файл' : 'Выбрать файл';
}

function setRoster(students, filename) {
  roster = students;
  plan = null;
  fileState.hidden = !students.length;
  fileName.textContent = filename;
  fileName.title = filename;

  if (students.length) {
    const desks = Number(desksInput.value);
    const rows = Number(rowsInput.value);
    const requiredRows = Math.ceil(students.length / (desks * 2));
    // Preserve the teacher's desk count and add rows as far as the room limit allows.
    if (requiredRows > rows) rowsInput.value = Math.min(requiredRows, MAX_ROWS);
  }
  setImporting(false);
  render();
}

async function importFile(file) {
  if (!file) return;
  const generation = ++importGeneration;
  showErrors();
  setImporting(true);
  render();
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('Файл слишком большой. Загрузите список размером до 5 МБ.');
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension !== 'xlsx' && extension !== 'csv') {
      throw new Error('Выберите файл .xlsx или .csv. Старый файл .xls можно пересохранить в Excel как .xlsx.');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const records = extension === 'xlsx' ? await readWorkbook(bytes) : readDelimited(decodeCsv(bytes));
    if (generation !== importGeneration) return;
    const { students, errors } = validateRoster(records);
    if (errors.length) showErrors(errors);
    else setRoster(students, file.name);
  } catch (error) {
    if (generation === importGeneration) {
      showErrors([error instanceof Error && /[А-Яа-яЁё]/.test(error.message)
        ? error.message : 'Не удалось прочитать файл. Проверьте, открывается ли он в Excel, и попробуйте снова.']);
    }
  } finally {
    if (generation === importGeneration && importing) {
      setImporting(false);
      render();
    }
  }
}

function calculate() {
  const rows = Number(rowsInput.value);
  const desks = Number(desksInput.value);
  if (!roster.length || roster.length > rows * desks * 2 || importing) return;
  plan = assignStudents(roster, rows, desks);
  render();
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  importFile(file);
});
dropzone.addEventListener('click', () => fileInput.click());
for (const eventName of ['dragenter', 'dragover']) {
  dropzone.addEventListener(eventName, event => {
    event.preventDefault();
    dropzone.classList.add('drag-over');
  });
}
dropzone.addEventListener('dragleave', event => {
  if (!(event.relatedTarget instanceof Node) || !dropzone.contains(event.relatedTarget)) {
    dropzone.classList.remove('drag-over');
  }
});
dropzone.addEventListener('drop', event => {
  event.preventDefault();
  dropzone.classList.remove('drag-over');
  if (event.dataTransfer.files.length > 1) {
    showErrors(['Загрузите один файл со списком класса.']);
  } else {
    importFile(event.dataTransfer.files[0]);
  }
});

byId('template-button').addEventListener('click', () => {
  download(makeWorkbook('Список учеников', [['ФИО', 'Рост (см)', 'Острота зрения']], [42, 16, 21]), 'Шаблон списка учеников.xlsx');
});
byId('example-button').addEventListener('click', () => {
  importGeneration++;
  showErrors();
  rowsInput.value = '4';
  desksInput.value = '3';
  setRoster(sample, 'Пример класса');
  calculate();
});
byId('clear-file').addEventListener('click', () => {
  importGeneration++;
  showErrors();
  setRoster([], '');
  dropzone.focus();
});
for (const input of [rowsInput, desksInput]) {
  input.addEventListener('change', () => {
    plan = null;
    render();
  });
}
calculateButton.addEventListener('click', calculate);
exportButton.addEventListener('click', () => {
  if (!plan) return;
  const records = plan.filter(seat => seat.student).map(seat => [seat.row, seat.desk, seat.side ? 'Справа' : 'Слева', seat.student.name]);
  download(makeWorkbook('Рассадка', [['Ряд от доски', 'Парта в ряду', 'Место', 'ФИО'], ...records], [17, 17, 14, 42]), 'План рассадки.xlsx');
});
printButton.addEventListener('click', () => { if (plan) window.print(); });
byId('help-button').addEventListener('click', () => byId('help-dialog').showModal());

populate(rowsInput, MAX_ROWS, 4);
populate(desksInput, MAX_DESKS, 3);
render();
