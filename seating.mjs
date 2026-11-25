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

// Hungarian algorithm for a rectangular cost matrix with at least as many seats as students.
function minimumAssignment(costs) {
  const studentCount = costs.length;
  const seatCount = costs[0].length;
  const studentPotential = new Float64Array(studentCount + 1);
  const seatPotential = new Float64Array(seatCount + 1);
  const seatOwner = new Int32Array(seatCount + 1);
  const previousSeat = new Int32Array(seatCount + 1);

  for (let student = 1; student <= studentCount; student++) {
    seatOwner[0] = student;
    const smallestCost = new Float64Array(seatCount + 1).fill(Infinity);
    const visited = new Uint8Array(seatCount + 1);
    let current = 0;

    do {
      visited[current] = 1;
      const owner = seatOwner[current];
      let nextSeat = 0;
      let delta = Infinity;

      for (let seat = 1; seat <= seatCount; seat++) {
        if (visited[seat]) continue;
        const cost = costs[owner - 1][seat - 1] - studentPotential[owner] - seatPotential[seat];
        if (cost < smallestCost[seat]) {
          smallestCost[seat] = cost;
          previousSeat[seat] = current;
        }
        if (smallestCost[seat] < delta) {
          delta = smallestCost[seat];
          nextSeat = seat;
        }
      }

      for (let seat = 0; seat <= seatCount; seat++) {
        if (visited[seat]) {
          studentPotential[seatOwner[seat]] += delta;
          seatPotential[seat] -= delta;
        } else {
          smallestCost[seat] -= delta;
        }
      }
      current = nextSeat;
    } while (seatOwner[current] !== 0);

    do {
      const previous = previousSeat[current];
      seatOwner[current] = seatOwner[previous];
      current = previous;
    } while (current !== 0);
  }

  return seatOwner.slice(1);
}

export function assignStudents(students, rows, desks) {
  const seats = seatsFor(rows, desks);
  if (students.length === 0) return seats;
  if (students.length > seats.length) throw new Error('В кабинете недостаточно мест.');

  const seatsPerRow = desks * 2;
  // Match exactly one slot per student so every row before the last used row is full.
  const rowSlots = seats.slice(0, students.length);
  const depthRange = Math.ceil(rowSlots.length / seatsPerRow) - 1;
  const heights = students.map(student => student.height);
  const shortest = Math.min(...heights);
  const heightRange = Math.max(...heights) - shortest;
  // One unit of the integer vision penalty outweighs the combined secondary costs.
  const visionPriority = 2 * students.length + 1;

  const costs = students.map(student => {
    const heightDepth = heightRange === 0 ? 0 : (student.height - shortest) / heightRange;
    const vision = Math.min(1, student.vision);
    const visionNeed = 1 - vision;
    const lastPreferredRow = 1 + Math.round(depthRange * vision ** 3);
    const visionSeverity = 100 + Math.round(100 * visionNeed);

    return rowSlots.map(seat => {
      const rowsBeyondPreference = Math.max(0, seat.row - lastPreferredRow);
      const depth = (seat.row - 1) / Math.max(1, depthRange);
      const heightLoss = (heightDepth - depth) ** 2;
      const visibilityLoss = 0.15 * visionNeed * depth;
      return visionPriority * visionSeverity * rowsBeyondPreference + heightLoss + visibilityLoss;
    });
  });

  const assignment = minimumAssignment(costs);
  const middleSeat = desks + 0.5;
  // Once rows are decided, give the central seats in each row to the weakest eyesight.
  for (let start = 0; start < rowSlots.length; start += seatsPerRow) {
    const end = start + seatsPerRow;
    const rowStudents = Array.from(assignment.subarray(start, end), owner => students[owner - 1])
      .sort((a, b) => a.vision - b.vision);
    const rowSeats = seats.slice(start, end)
      .sort((a, b) => Math.abs(a.number - middleSeat) - Math.abs(b.number - middleSeat));
    rowStudents.forEach((student, index) => { rowSeats[index].student = student; });
  }
  return seats;
}
