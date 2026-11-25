import { makeWorkbook } from './excel.mjs?v=2';
import { validateStudent } from './roster.mjs?v=2';
import { assignStudents, MAX_DESKS, MAX_ROWS, MAX_STUDENTS, seatsFor } from './seating.mjs';

const byId = id => document.getElementById(id);
const studentForm = byId('student-form');
const studentInputs = {
  name: byId('student-name'),
  height: byId('student-height'),
  vision: byId('student-vision'),
};
const studentError = byId('student-error');
const saveStudent = byId('save-student');
const saveLabel = byId('save-student-label');
const cancelEdit = byId('cancel-edit');
const exampleButton = byId('example-button');
const rosterContent = byId('roster-content');
const rosterList = byId('roster-list');
const rowTemplate = byId('student-row-template');
const studentCount = byId('student-count');
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
let editingStudent = null;

const plural = new Intl.PluralRules('ru');
const number = new Intl.NumberFormat('ru', { maximumFractionDigits: 12 });
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
  calculateButton.disabled = !roster.length || Boolean(shortfall);
  exportButton.disabled = !plan;
  printButton.disabled = !plan;

  if (plan) status.textContent = `${pupils(roster.length)} · свободно ${places(total - roster.length)}`;
  else if (roster.length) status.textContent = `В списке ${pupils(roster.length)}. Распределите места.`;
  else status.textContent = 'Добавьте учеников, чтобы распределить места';

  renderSeats(plan ?? seatsFor(rows, desks), desks);
}

function showStudentErrors(errors = {}) {
  const messages = Object.values(errors);
  studentError.hidden = !messages.length;
  studentError.textContent = messages.join(' ');
  for (const [field, input] of Object.entries(studentInputs)) {
    if (errors[field]) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

function renderEditor() {
  const editing = Boolean(editingStudent);
  saveLabel.textContent = editing ? 'Сохранить изменения' : 'Добавить ученика';
  saveStudent.querySelector('svg').toggleAttribute('hidden', editing);
  saveStudent.disabled = !editing && roster.length >= MAX_STUDENTS;
  cancelEdit.hidden = !editing;
  exampleButton.hidden = roster.length > 0;
}

function resetEditor() {
  editingStudent = null;
  studentForm.reset();
  showStudentErrors();
  renderEditor();
}

function editStudent(student) {
  editingStudent = student;
  studentInputs.name.value = student.name;
  studentInputs.height.value = String(student.height).replace('.', ',');
  studentInputs.vision.value = String(student.vision).replace('.', ',');
  showStudentErrors();
  renderEditor();
  studentInputs.name.focus();
}

function removeStudent(student) {
  const index = roster.indexOf(student);
  roster.splice(index, 1);
  if (editingStudent === student) resetEditor();
  renderUpdatedRoster();
  const next = rosterList.children[Math.min(index, roster.length - 1)];
  (next?.querySelector('.remove-student') ?? studentInputs.name).focus();
}

function renderUpdatedRoster() {
  const scrollTop = rosterList.scrollTop;
  const fragment = document.createDocumentFragment();
  for (const student of roster) {
    const row = rowTemplate.content.cloneNode(true);
    row.querySelector('.roster-name').textContent = student.name;
    row.querySelector('.roster-details').textContent = `${number.format(student.height)} см · Зрение ${number.format(student.vision)}`;
    const edit = row.querySelector('.edit-student');
    edit.setAttribute('aria-label', `Изменить: ${student.name}`);
    edit.addEventListener('click', () => editStudent(student));
    const remove = row.querySelector('.remove-student');
    remove.setAttribute('aria-label', `Удалить: ${student.name}`);
    remove.addEventListener('click', () => removeStudent(student));
    fragment.append(row);
  }
  studentCount.textContent = pupils(roster.length);
  rosterContent.hidden = !roster.length;
  rosterList.replaceChildren(fragment);
  rosterList.scrollTop = scrollTop;
  renderEditor();
  plan = null;
  render();
}

function calculate() {
  const rows = Number(rowsInput.value);
  const desks = Number(desksInput.value);
  if (!roster.length || roster.length > rows * desks * 2) return;
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

studentForm.addEventListener('submit', event => {
  event.preventDefault();
  if (!editingStudent && roster.length >= MAX_STUDENTS) return;
  const { student, errors } = validateStudent(studentInputs.name.value, studentInputs.height.value, studentInputs.vision.value);
  if (!student) {
    showStudentErrors(errors);
    const firstInvalid = Object.keys(errors)[0];
    studentInputs[firstInvalid].focus();
    return;
  }
  const adding = !editingStudent;
  if (adding) roster.push(student);
  else roster[roster.indexOf(editingStudent)] = student;
  resetEditor();
  renderUpdatedRoster();
  if (adding) rosterList.scrollTop = rosterList.scrollHeight;
  studentInputs.name.focus();
});
cancelEdit.addEventListener('click', () => {
  resetEditor();
  studentInputs.name.focus();
});
studentForm.addEventListener('input', () => {
  if (!studentError.hidden) showStudentErrors();
  exampleButton.hidden = roster.length > 0 || Object.values(studentInputs).some(input => input.value.trim());
});
exampleButton.addEventListener('click', () => {
  roster = [...sample];
  resetEditor();
  renderUpdatedRoster();
  calculate();
});
byId('clear-roster').addEventListener('click', () => {
  if (!window.confirm('Очистить список учеников и план рассадки?')) return;
  roster = [];
  resetEditor();
  renderUpdatedRoster();
  studentInputs.name.focus();
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
