/**
 * Calculate the number of seats still available on an organisation plan.
 *
 * A null/undefined seatLimit means the plan has no seat cap (e.g. the
 * self-hosted free plan), in which case the available seats are unlimited.
 *
 * @param seatLimit Total seats allowed by the plan, or null/undefined for unlimited.
 * @param seatsUsed Seats currently consumed (members + valid invites + service accounts).
 *
 * @return Remaining seats, or Infinity when the plan is uncapped.
 */
export const getAvailableSeats = (
  seatLimit?: number | null,
  seatsUsed?: number | null
): number => {
  if (seatLimit == null) return Infinity
  return seatLimit - (seatsUsed ?? 0)
}
