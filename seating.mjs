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

  const usedRows = Math.ceil(students.length / (desks * 2));
  const availableSeats = seats.slice(0, usedRows * desks * 2);
  const heights = students.map(student => student.height).sort((a, b) => a - b);
  const costs = students.map(student => {
    // Students of the same height have the same target depth.
    const first = heights.indexOf(student.height);
    const last = heights.lastIndexOf(student.height);
    const heightRank = (first + last) / (2 * Math.max(1, heights.length - 1));
    const visionNeed = Math.max(0, 1 - student.vision);

    return availableSeats.map(seat => {
      const depth = (seat.row - 1) / Math.max(1, usedRows - 1);
      const offset = Math.abs(seat.number - (2 * desks + 1) / 2) / Math.max(1, desks - 0.5);
      const heightLoss = 0.9 * (heightRank - depth) ** 2;
      const visionLoss = 2.6 * visionNeed * (depth + 0.28 * offset);
      return heightLoss + visionLoss + 0.004 * offset;
    });
  });

  minimumAssignment(costs).forEach((owner, index) => {
    if (owner > 0) seats[index].student = students[owner - 1];
  });
  return seats;
}
