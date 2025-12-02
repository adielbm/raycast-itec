/**
 * HTML parsing utilities for ITEC API responses
 */

export interface CourtSlot {
  courtNumber: number;
  courtId: number;
  duration: number;
  startTime: string;
  endTime: string;
}

/**
 * Check if the response indicates no courts available
 */
export function isNoCourtsAvailable(html: string): boolean {
  return !html.includes("בחר");
}

/**
 * Check if the response indicates reserved (for kids/tournaments)
 */
export function isReserved(html: string): boolean {
  return html.includes("לא נמצאו מגרשים פנויים");
}

/**
 * Parse court slots from HTML response
 * Example row:
 * <tr>\n  <td>\n    מגרש: 4\n  </td>\n  <td width="10%"><a class="btn btn-md btn-primary btn-choose" data-type="script" data-remote="true" rel="nofollow" data-method="post" href="/self_services/select_court_invitation.js?court_id=112&amp;duration=1.0&amp;end_time=2025-12-04+22%3A00%3A00+UTC&amp;start_time=2025-12-04+21%3A00%3A00+UTC">בחר&nbsp;&nbsp;<i class='fa fa-arrow-circle-left'></i></a></td>\n</tr>
 */
export function parseCourtSlots(html: string): CourtSlot[] {
  const slots: CourtSlot[] = [];

  // 1. Matches "מגרש:" followed by the court number
  // 2. Scans ahead to find the URL parameters in the href attribute:
  //    court_id, duration, end_time, and start_time
  // Note: Matches &amp; because the URL is inside an HTML attribute
  const rowRegex = /מגרש:\s*(\d+)[\s\S]*?court_id=(\d+)&amp;duration=([\d.]+)&amp;end_time=([^&]+)&amp;start_time=([^"&]+)/g;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    slots.push({
      courtNumber: parseInt(match[1], 10),
      courtId: parseInt(match[2], 10),
      duration: parseFloat(match[3]),
      endTime: decodeURIComponent(match[4].replace(/\+/g, " ")),
      startTime: decodeURIComponent(match[5].replace(/\+/g, " ")),
    });
  }

  return slots;
}

export function extractHtmlFromResponse(response: string): string {
  // Captures the content inside the jQuery .html('...') function call
  const match = response.match(/jQuery\('#step-2'\)\.html\('([\s\S]*?)'\);/);
  
  if (!match) return "";

  // The content is a JS string literal, so we must unescape it to get valid HTML
  // 1. Remove escaped newlines (\n)
  // 2. Unescape double quotes (\")
  // 3. Unescape forward slashes (\/)
  return match[1]
    .replace(/\\n/g, "")
    .replace(/\\"/g, '"')
    .replace(/\\\//g, "/");
}


/**
 * Parse the full API response and determine availability status
 */
export interface CourtAvailability {
  status: "available" | "reserved" | "no-courts";
  courts: number[]; // Available court numbers
  slots: CourtSlot[]; // Detailed slot information
}

export function parseCourtAvailability(response: string): CourtAvailability {
  const html = extractHtmlFromResponse(response);

  if (isReserved(html)) {

    // console.log("isReserved");

    return {
      status: "reserved",
      courts: [],
      slots: [],
    };
  }

  if (isNoCourtsAvailable(html)) {

    // console.log("isNoCourtsAvailable");

    return {
      status: "no-courts",
      courts: [],
      slots: [],
    };
  }

  const slots = parseCourtSlots(html);
  const courts = [...new Set(slots.map((s) => s.courtNumber))].sort((a, b) => a - b);

  // If no court rows were found but it's also not Reserved and not the "no courts" message,
  // it means all courts are booked (taken by other people)
  if (slots.length === 0) {

    // console.log("slots.length === 0");

    return {
      status: "no-courts",
      courts: [],
      slots: [],
    };
  }

  return {
    status: "available",
    courts,
    slots,
  };
}
