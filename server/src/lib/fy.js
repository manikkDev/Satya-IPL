// Indian fiscal year: April–March. fyOf("2026-10-29") -> "2026-27".
export const fyOf = (dateLike) => {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date for fiscal year");
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-based; April = 3
  const start = month >= 3 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
};

export const fyStartDate = (fy) => new Date(Date.UTC(Number(fy.slice(0, 4)), 3, 1));
