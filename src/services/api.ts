import fetch from "node-fetch";
import { Cache } from "@raycast/api";
import { getAuthTokens, AuthCredentials } from "./auth";
import { parseCourtAvailability, CourtAvailability } from "../utils/parser";
import { formatDate } from "../utils/date";

const BASE_URL = "https://center.tennis.org.il";
const SEARCH_COURT_URL = `${BASE_URL}/self_services/search_court.js`;
const SET_TIME_BY_UNIT_URL = `${BASE_URL}/self_services/set_time_by_unit`;
const SELECT_COURT_URL = `${BASE_URL}/self_services/select_court_invitation.js`;
const MY_RENTS_URL = `${BASE_URL}/self_services/my_rents`;

// Cache for time slots by unit and weekday
const timeSlotsCache = new Cache();

export interface SearchCourtParams {
  unitId: string; // Tennis center ID
  date: Date;
  startHour: string; // Format: HH:mm
  duration: number; // 1, 1.5, 2, or 3
}

/**
 * Search for available courts
 */
export async function searchCourts(
  params: SearchCourtParams,
  credentials: AuthCredentials
): Promise<CourtAvailability | null> {
  try {
    // Get authentication tokens
    const tokens = await getAuthTokens(credentials);
    if (!tokens) {
      throw new Error("Failed to authenticate");
    }

    // Prepare form data
    const formData = new URLSearchParams();
    formData.append("utf8", "✓");
    formData.append("authenticity_token", tokens.authenticityToken);
    formData.append("search[unit_id]", params.unitId);
    formData.append("search[court_type]", "1"); // Always 1 for tennis court
    formData.append("search[start_date]", formatDate(params.date));
    formData.append("search[start_hour]", params.startHour);
    formData.append("search[duration]", params.duration.toString());

    // Make the request
    const response = await fetch(SEARCH_COURT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: `_session_id=${tokens.sessionId}`,
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const responseText = await response.text();

    // Parse the response
    return parseCourtAvailability(responseText);
  } catch (error) {
    console.error("Error searching courts:", error);
    return null;
  }
}

/**
 * Search for courts across multiple time slots
 */
export async function searchMultipleSlots(
  slots: Array<{ date: Date; time: string }>,
  unitId: string,
  duration: number,
  credentials: AuthCredentials
): Promise<Map<string, CourtAvailability>> {
  const results = new Map<string, CourtAvailability>();

  // Process slots sequentially to avoid overwhelming the server
  for (const slot of slots) {
    const key = `${formatDate(slot.date)}_${slot.time}`;

    const availability = await searchCourts(
      {
        unitId,
        date: slot.date,
        startHour: slot.time,
        duration,
      },
      credentials
    );

    if (availability) {
      results.set(key, availability);
    }

    // Small delay to be nice to the server
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return results;
}

/**
 * Fetch available time slots for a specific unit and date
 * Results are cached by unit ID and day of week
 */
export async function fetchTimeSlots(
  unitId: string,
  date: Date,
  credentials: AuthCredentials
): Promise<string[]> {
  const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
  const cacheKey = `timeslots_${unitId}_${dayOfWeek}`;

  // console.log(`[fetchTimeSlots] Fetching for unitId=${unitId}, dayOfWeek=${dayOfWeek}, cacheKey=${cacheKey}`);

  // Check cache first
  if (timeSlotsCache.has(cacheKey)) {
    const cached = timeSlotsCache.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        // console.log(`[fetchTimeSlots] Cache HIT - returning ${parsed.length} slots:`, parsed);
        return parsed;
      } catch (e) {
        // console.log(`[fetchTimeSlots] Cache parse error:`, e);
        // Invalid cache, continue to fetch
      }
    }
  }
  // console.log(`[fetchTimeSlots] Cache MISS - fetching from API`);

  try {
    // Get authentication tokens
    const tokens = await getAuthTokens(credentials);
    if (!tokens) {
      throw new Error("Failed to authenticate");
    }

    // Format date as YYYY-MM-DD
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;

    // console.log(`[fetchTimeSlots] Request params: unit_id=${unitId}, date=${dateStr}, court_type=1`);

    // Prepare form data
    const formData = new URLSearchParams();
    formData.append("unit_id", unitId);
    formData.append("date", dateStr);
    formData.append("court_type", "1");

    // Make the request
    const response = await fetch(SET_TIME_BY_UNIT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: `_session_id=${tokens.sessionId}`,
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      // console.log(`[fetchTimeSlots] HTTP error! status: ${response.status}`);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const responseText = await response.text();
    // console.log(`[fetchTimeSlots] Response length: ${responseText.length} chars`);
    // console.log(`[fetchTimeSlots] Full response:`, responseText);
    
    // Find the start_hour section
    const startHourIndex = responseText.indexOf("start_hour_select");
    if (startHourIndex !== -1) {
      // console.log(`[fetchTimeSlots] start_hour section:`, responseText.substring(startHourIndex, startHourIndex + 1000));
    }

    // Parse the JavaScript response to extract time slots
    const timeSlots = parseTimeSlots(responseText);
    // console.log(`[fetchTimeSlots] Parsed ${timeSlots.length} time slots:`, timeSlots);

    // Cache the result
    timeSlotsCache.set(cacheKey, JSON.stringify(timeSlots));
    // console.log(`[fetchTimeSlots] Cached result for key: ${cacheKey}`);

    return timeSlots;
  } catch (error) {
    console.error("Error fetching time slots:", error);
    // Return empty array on error
    return [];
  }
}

/**
 * Parse time slots from the jQuery HTML response
 * Extracts all available time slots, filtering to show half-hour slots only when
 * the corresponding full hour is not available
 */
function parseTimeSlots(responseText: string): string[] {
  const allSlots: string[] = [];

  const patterns = [
    // 1. Matches escaped quotes: value=\"08:00\" (This is what your input contains)
    // We need strict matching for \d{2}:\d{2} to avoid matching value="1" (the court type)
    new RegExp('value=\\\\"(\\d{2}:\\d{2})\\\\"', 'g'), 
    
    // 2. Matches standard quotes: value="08:00" (Fallback for standard HTML)
    new RegExp('value="(\\d{2}:\\d{2})"', 'g'),
    
    // 3. Matches single quotes: value='08:00'
    new RegExp("value='(\\d{2}:\\d{2})'", 'g'),
  ];

  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i];
    // console.log(`[parseTimeSlots] Trying pattern ${i + 1}: ${pattern}`);
    
    pattern.lastIndex = 0; 
    let match;
    let matchCount = 0;
    
    while ((match = pattern.exec(responseText)) !== null) {
      matchCount++;
      const time = match[1];
      
      // Check !includes to prevent duplicates
      if (!allSlots.includes(time)) {
        allSlots.push(time);
        // console.log(`[parseTimeSlots] ✓ Found time slot: ${time}`);
      }
    }
    
    // If we found slots with this pattern, we can stop checking other patterns
    if (allSlots.length > 0) {
      // console.log(`[parseTimeSlots] Success with pattern ${i+1}! Found ${allSlots.length} slots`);
      break;
    }
  }

  // Filter: include half-hour slots only if the next full hour is not available
  const filteredSlots: string[] = [];
  
  for (const slot of allSlots) {
    if (slot.endsWith(':00')) {
      // Always include full hours
      filteredSlots.push(slot);
    } else if (slot.endsWith(':30')) {
      // Include half hour only if the next full hour is NOT in the list
      const [hours, _] = slot.split(':');
      const nextHour = String(parseInt(hours) + 1).padStart(2, '0') + ':00';
      
      if (!allSlots.includes(nextHour)) {
        filteredSlots.push(slot);
        // console.log(`[parseTimeSlots] Including ${slot} because ${nextHour} is not available`);
      } else {
        // console.log(`[parseTimeSlots] Skipping ${slot} because ${nextHour} is available`);
      }
    }
  }

  // console.log(`[parseTimeSlots] Filtered to ${filteredSlots.length} slots:`, filteredSlots);
  return filteredSlots;
}

/**
 * Fetch user's rental history
 */
export async function fetchMyRents(credentials: AuthCredentials): Promise<string | null> {
  try {
    // Get authentication tokens
    const tokens = await getAuthTokens(credentials);
    if (!tokens) {
      throw new Error("Failed to authenticate");
    }

    // Make the request
    const response = await fetch(MY_RENTS_URL, {
      method: "GET",
      headers: {
        Cookie: `_session_id=${tokens.sessionId}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const responseText = await response.text();
    return responseText;
  } catch (error) {
    console.error("Error fetching my rents:", error);
    return null;
  }
}

/**
 * Cancel a rental allocation
 */
export async function cancelRent(allocationId: string, credentials: AuthCredentials): Promise<boolean> {
  try {
    // Get authentication tokens
    const tokens = await getAuthTokens(credentials);
    if (!tokens) {
      throw new Error("Failed to authenticate");
    }

    const cancelUrl = `${BASE_URL}/self_services/cancel_rent_allocation/${allocationId}.js`;

    // Make the POST request to cancel
    const response = await fetch(cancelUrl, {
      method: "POST",
      headers: {
        Cookie: `_session_id=${tokens.sessionId}`,
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return true;
  } catch (error) {
    console.error("Error canceling rent:", error);
    return false;
  }
}

/**
 * Select a court for booking
 */
export interface SelectCourtParams {
  courtId: number;
  duration: number;
  startTime: string; // Format: YYYY-MM-DD HH:mm:ss UTC
  endTime: string; // Format: YYYY-MM-DD HH:mm:ss UTC
}

export async function selectCourt(
  params: SelectCourtParams,
  credentials: AuthCredentials
): Promise<string | null> {
  try {
    // Get authentication tokens
    const tokens = await getAuthTokens(credentials);
    if (!tokens) {
      throw new Error("Failed to authenticate");
    }

    // Build the URL with query parameters
    const url = new URL(SELECT_COURT_URL);
    url.searchParams.append("court_id", params.courtId.toString());
    url.searchParams.append("duration", params.duration.toString());
    url.searchParams.append("end_time", params.endTime);
    url.searchParams.append("start_time", params.startTime);

    // console.log(`[selectCourt] Making POST request to: ${url.toString()}`);

    // Make the POST request - this sets up the selection on the server session
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Cookie: `_session_id=${tokens.sessionId}`,
        "X-Requested-With": "XMLHttpRequest",
      },
      redirect: "manual",
    });

    if (!response.ok && response.status !== 302) {
      console.error(`[selectCourt] HTTP error! status: ${response.status}`);
      return null;
    }

    const responseText = await response.text();
    // console.log(`[selectCourt] Response:`, responseText);

    // Return the court invitation page
    // Unfortunately, the browser won't have our session cookie, so the user
    // will need to log in on the website to see/complete the booking
    return `${BASE_URL}/self_services/court_invitation`;
  } catch (error) {
    console.error("Error selecting court:", error);
    return null;
  }
}