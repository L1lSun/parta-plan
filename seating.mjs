export const MAX_ROWS = 10;
export const MAX_DESKS = 6;
export const MAX_STUDENTS = MAX_ROWS * MAX_DESKS * 2;

export function seatsFor(rows, desks) {
  return Array.from({ length: rows * desks * 2 }, (_, index) => ({
    row: Math.floor(index / (desks * 2)) + 1,
    desk: Math.floor(index / 2) % desks + 1,
    side: index % 2,
    number: index % (desks * 2) + 1,
    student: null,
  }));
}

export function assignStudents(students, rows, desks) {
  const seats = seatsFor(rows, desks);
  if (students.length > seats.length) throw new Error('В кабинете недостаточно мест.');

  const seatsPerRow = desks * 2;
  const middleSeat = desks + 0.5;
  const byVision = (a, b) => a.vision - b.vision;
  const orderedStudents = [...students].sort((a, b) => a.height - b.height || byVision(a, b));

  // Split the height order into consecutive rows, then use vision to choose seats within each row.
  for (let start = 0; start < orderedStudents.length; start += seatsPerRow) {
    const end = start + seatsPerRow;
    const rowStudents = orderedStudents.slice(start, end).sort(byVision);
    const rowSeats = seats.slice(start, end)
      .sort((a, b) => Math.abs(a.number - middleSeat) - Math.abs(b.number - middleSeat));
    rowStudents.forEach((student, index) => { rowSeats[index].student = student; });
  }
  return seats;
}
