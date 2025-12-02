/**
 * Date and time utilities for ITEC API
 */

/**
 * Format date for ITEC API (dd/MM/yyyy)
 */
export function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Format time for ITEC API (HH:mm)
 */
export function formatTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Get the current hour rounded down
 */
export function getCurrentHour(): Date {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  return now;
}

/**
 * Get day of week (0 = Sunday, 6 = Saturday)
 */
export function getDayOfWeek(date: Date): number {
  return date.getDay();
}

/**
 * Get valid time slots based on day of week
 * Sun-Thu: 8:00-22:00
 * Fri: 7:00-16:00
 * Sat: 7:00-12:00, 16:00-21:00
 */
export function getValidTimeSlots(date: Date): string[] {
  const dayOfWeek = getDayOfWeek(date);
  const slots: string[] = [];

  if (dayOfWeek >= 0 && dayOfWeek <= 4) {
    // Sunday to Thursday: 8:00-22:00
    for (let hour = 8; hour <= 22; hour++) {
      slots.push(`${String(hour).padStart(2, "0")}:00`);
    }
  } else if (dayOfWeek === 5) {
    // Friday: 7:00-16:00
    for (let hour = 7; hour <= 16; hour++) {
      slots.push(`${String(hour).padStart(2, "0")}:00`);
    }
  } else if (dayOfWeek === 6) {
    // Saturday: 7:00-12:00, 16:00-21:00
    for (let hour = 7; hour <= 12; hour++) {
      slots.push(`${String(hour).padStart(2, "0")}:00`);
    }
    for (let hour = 16; hour <= 21; hour++) {
      slots.push(`${String(hour).padStart(2, "0")}:00`);
    }
  }

  return slots;
}

/**
 * Generate time slots for the next N days starting from a given date/time
 */
export function generateTimeSlots(startDate: Date, days: number): Array<{ date: Date; time: string }> {
  const slots: Array<{ date: Date; time: string }> = [];
  const currentDate = new Date(startDate);
  const startHour = startDate.getHours();

  for (let day = 0; day < days; day++) {
    const date = new Date(currentDate);
    date.setDate(currentDate.getDate() + day);

    const validSlots = getValidTimeSlots(date);

    // For the first day, only include slots from the current hour onwards
    const slotsToInclude =
      day === 0 ? validSlots.filter((slot) => parseInt(slot.split(":")[0]) >= startHour) : validSlots;

    for (const time of slotsToInclude) {
      slots.push({ date: new Date(date), time });
    }
  }

  return slots;
}

/**
 * Format a date and time for display
 */
export function formatDisplayDateTime(date: Date, time: string): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayName = days[date.getDay()];
  const dateStr = formatDate(date);
  return `${dayName} ${dateStr} ${time}`;
}

/**
 * Get start of today at midnight
 */
export function getToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/**
 * Get start of tomorrow at midnight
 */
export function getTomorrow(): Date {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow;
}

/**
 * Generate array of dates for next N days starting from a given date
 */
export function getNextDays(startDate: Date, days: number): Date[] {
  const dates: Date[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    dates.push(date);
  }
  return dates;
}

/**
 * Generate time slots for a specific date starting from current hour if it's today
 * Can accept custom time slots from the API or use default slots
 * Filters to show half-hour slots only when the next full hour is not available
 */
export function generateTimeSlotsForDate(
  date: Date,
  availableTimeSlots?: string[]
): Array<{ date: Date; time: string }> {
  const slots: Array<{ date: Date; time: string }> = [];
  const validSlots = availableTimeSlots || getValidTimeSlots(date);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const currentHour = now.getHours();

  // Filter slots if it's today
  let slotsToInclude = isToday 
    ? validSlots.filter((slot) => parseInt(slot.split(":")[0]) > currentHour)
    : validSlots;

  // Filter: include half-hour slots only if the next full hour is not available
  slotsToInclude = slotsToInclude.filter((slot) => {
    if (slot.endsWith(':00')) {
      // Always include full hours
      return true;
    } else if (slot.endsWith(':30')) {
      // Include half hour only if the next full hour is NOT in the list
      const [hours, _] = slot.split(':');
      const nextHour = String(parseInt(hours) + 1).padStart(2, '0') + ':00';
      return !slotsToInclude.includes(nextHour);
    }
    return true;
  });

  for (const time of slotsToInclude) {
    slots.push({ date: new Date(date), time });
  }

  return slots;
}

/**
 * Format date for display with day name
 */
export function formatDateDisplay(date: Date): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayName = days[date.getDay()];
  const dateStr = formatDate(date);
  return `${dayName}, ${dateStr}`;
}
