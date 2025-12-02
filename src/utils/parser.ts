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

  if (html.includes("alert-success")) {
    return false;
  }

  return html.includes("מועדים אחרים") || html.includes("alert-danger") || html.includes("נסה מועד אחר");
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
  status: "available" | "no-courts";
  courts: number[]; // Available court numbers
  slots: CourtSlot[]; // Detailed slot information
  suggestedTimes?: string[]; // Alternative time suggestions when no courts available
}

export function parseCourtAvailability(response: string): CourtAvailability {
  const html = extractHtmlFromResponse(response);



  if (isNoCourtsAvailable(html)) {

    // console.log("isNoCourtsAvailable");

    // Check if there are alternative time suggestions in the HTML
    const suggestedTimes = parseSuggestedTimes(html);
    
    if (suggestedTimes.length > 0) {
      // console.log("Found suggested alternative times:", suggestedTimes);
    }

    return {
      status: "no-courts",
      courts: [],
      slots: [],
      suggestedTimes: suggestedTimes.length > 0 ? suggestedTimes : undefined,
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

/**
 * Parse suggested alternative times from "no courts available" response
 * Example: <h3>20:30-21:30</h3> or <h3>21:00-22:00</h3>
 */
export function parseSuggestedTimes(html: string): string[] {
  const times: string[] = [];
  
  // Match time ranges in <h3> tags like "20:30-21:30" or "21:00-22:00"
  const timeRegex = /<h3>(\d{2}:\d{2})-\d{2}:\d{2}<\/h3>/g;
  
  let match;
  while ((match = timeRegex.exec(html)) !== null) {
    const startTime = match[1];
    if (!times.includes(startTime)) {
      times.push(startTime);
      // console.log(`[parseSuggestedTimes] Found suggested time: ${startTime}`);
    }
  }
  
  return times;
}
