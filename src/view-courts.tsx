import { List, getPreferenceValues, showToast, Toast, Color, Icon, Action, ActionPanel, Cache, open, Clipboard, showHUD, confirmAlert } from "@raycast/api";
import { useState, useEffect } from "react";
import { searchCourts, fetchTimeSlots, selectCourt } from "./services/api";
import { getToday, getNextDays, generateTimeSlotsForDate, formatDisplayDateTime, formatDateDisplay } from "./utils/date";
import { CourtAvailability, CourtSlot } from "./utils/parser";
import { bookCourtAutomatically } from "./services/puppeteer";

interface Preferences {
  tennisCenter: string;
  email: string;
  userId: string;
}

interface TimeSlotResult {
  dateTime: string;
  date: Date;
  time: string;
  availability: CourtAvailability | null;
  isLoading: boolean;
  isRangeStart?: boolean; // For consolidated reserved ranges
  rangeEnd?: string; // End time of reserved range
}

// Cache for reserved slots (persists across extension sessions)
const reservedCache = new Cache();

function CourtsList({
  slots,
  time,
  date,
  onBack
}: {
  slots: CourtSlot[];
  time: string;
  date: Date;
  onBack: () => void;
}) {
  const preferences = getPreferenceValues<Preferences>();
  const [availabilityByDuration, setAvailabilityByDuration] = useState<Map<number, Map<number, CourtAvailability>>>(new Map());
  const [isLoadingDurations, setIsLoadingDurations] = useState(true);
  const [isBooking, setIsBooking] = useState(false);

  // Extract unique court numbers from slots
  const courtNumbers = [...new Set(slots.map(s => s.courtNumber))];

  useEffect(() => {
    async function fetchDurationAvailability() {
      const durations = [1, 2, 3]; // Check 1, 2, and 3 hour durations
      const availabilityMap = new Map<number, Map<number, CourtAvailability>>();

      for (const duration of durations) {
        const courtMap = new Map<number, CourtAvailability>();

        const availability = await searchCourts(
          {
            unitId: preferences.tennisCenter,
            date: date,
            startHour: time,
            duration: duration,
          },
          {
            email: preferences.email,
            userId: preferences.userId,
          }
        );

        if (availability && availability.status === "available") {
          // Map by court number
          availability.slots.forEach(slot => {
            courtMap.set(slot.courtNumber, availability);
          });
        }

        availabilityMap.set(duration, courtMap);
      }

      setAvailabilityByDuration(availabilityMap);
      setIsLoadingDurations(false);
    }

    fetchDurationAvailability();
  }, [time, date, preferences.tennisCenter, preferences.email, preferences.userId]);
  const handleOpenBookingPage = async () => {
    await open("https://center.tennis.org.il/self_services/court_invitation");
  };

  const handleBookCourt = async (slot: CourtSlot, duration: number = 1) => {
    if (isBooking) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Booking in progress",
        message: "Please wait for the current booking to complete",
      });
      return;
    }

    const confirmed = await confirmAlert({
      title: "Confirm Booking",
      message: `Book Court ${slot.courtNumber} at ${time} for ${duration} hour${duration > 1 ? 's' : ''}?`,
      primaryAction: {
        title: "Book Court",
      },
    });

    if (!confirmed) {
      return;
    }

    setIsBooking(true);

    try {
      const success = await bookCourtAutomatically({
        unitId: preferences.tennisCenter,
        courtId: slot.courtId,
        courtNumber: slot.courtNumber,
        date: date,
        startHour: time,
        duration: duration,
      });

      if (success) {
        await showToast({
          style: Toast.Style.Success,
          title: "Booking completed!",
          message: `Court ${slot.courtNumber} has been booked`,
        });
      }
    } catch (error) {
      console.error("Error booking court:", error);
      await showToast({
        style: Toast.Style.Failure,
        title: "Booking failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsBooking(false);
    }
  };

  // Check which durations are available for each court
  const getAvailableDurations = (courtNumber: number): number[] => {
    const durations: number[] = [];
    availabilityByDuration.forEach((courtMap, duration) => {
      if (courtMap.has(courtNumber)) {
        durations.push(duration);
      }
    });
    return durations.sort((a, b) => a - b);
  };

  return (
    <List
      navigationTitle={`Select Court - ${time}`}
      searchBarPlaceholder="Choose a court..."
      isLoading={isLoadingDurations || isBooking}
    >
      {slots.map((slot) => {
        const availableDurations = getAvailableDurations(slot.courtNumber);

        return (
          <List.Item
            key={slot.courtId}
            icon={{ source: Icon.TennisBall, tintColor: Color.Green }}
            title={`Court ${slot.courtNumber}`}
            subtitle={availableDurations.length > 0 ? `Up to ${Math.max(...availableDurations)} hour${Math.max(...availableDurations) > 1 ? 's' : ''}` : ''}
            actions={
              <ActionPanel>
                <ActionPanel.Section title="Booking">
                  {availableDurations.map((duration) => (
                    <Action
                      key={duration}
                      title={`Book for ${duration} Hour${duration > 1 ? 's' : ''}`}
                      icon={Icon.CheckCircle}
                      onAction={() => handleBookCourt(slot, duration)}
                    />
                  ))}
                  {availableDurations.length === 0 && (
                    <Action
                      title="Book for 1 Hour"
                      icon={Icon.CheckCircle}
                      onAction={() => handleBookCourt(slot, 1)}
                    />
                  )}
                </ActionPanel.Section>
                <ActionPanel.Section title="Other Actions">
                  <Action title="Go Back" icon={Icon.ArrowLeft} onAction={onBack} />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

function CourtsForDate({ selectedDate }: { selectedDate: Date }) {
  const preferences = getPreferenceValues<Preferences>();
  const [results, setResults] = useState<TimeSlotResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<{ slots: CourtSlot[]; time: string } | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function fetchCourts() {
      try {
        // Show initial loading toast
        await showToast({
          style: Toast.Style.Animated,
          title: "Loading courts",
          message: "Fetching available time slots...",
        });

        // console.log(`[fetchCourts] Starting for date: ${selectedDate.toDateString()}, center: ${preferences.tennisCenter}`);

        if (isCancelled) {
          // console.log(`[fetchCourts] Cancelled before starting`);
          return;
        }

        // First, fetch available time slots for this unit and date
        const availableTimeSlots = await fetchTimeSlots(
          preferences.tennisCenter,
          selectedDate,
          {
            email: preferences.email,
            userId: preferences.userId,
          }
        );

        // console.log(`[fetchCourts] Received ${availableTimeSlots.length} time slots from API:`, availableTimeSlots);

        // Generate time slots for the selected date using fetched slots
        const slots = generateTimeSlotsForDate(selectedDate, availableTimeSlots);
        // console.log(`[fetchCourts] Generated ${slots.length} slots for display:`, slots);

        // Initialize results with loading state
        const initialResults: TimeSlotResult[] = slots.map((slot) => ({
          dateTime: formatDisplayDateTime(slot.date, slot.time),
          date: slot.date,
          time: slot.time,
          availability: null,
          isLoading: true,
        }));

        setResults(initialResults);

        // Update toast for checking availability
        await showToast({
          style: Toast.Style.Animated,
          title: "Checking availability",
          message: `Scanning ${slots.length} time slots...`,
        });

        // Collect all suggested times first, then add them after all batches
        const allSuggestedTimes = new Set<string>();

        // Fetch availability in batches of 5
        const batchSize = 5;
        // console.log(`[fetchCourts] Total slots to fetch: ${slots.length}`);
        for (let batchStart = 0; batchStart < slots.length; batchStart += batchSize) {
          const batchEnd = Math.min(batchStart + batchSize, slots.length);
          const batchSlots = slots.slice(batchStart, batchEnd);
          // console.log(`[fetchCourts] Processing batch ${batchStart}-${batchEnd - 1}, slots:`, batchSlots.map(s => s.time));

          // Process batch in parallel
          const batchPromises = batchSlots.map(async (slot, batchIndex) => {
            const actualIndex = batchStart + batchIndex;
            // console.log(`[fetchCourts] Fetching slot ${actualIndex}: ${slot.time}`);

            const availability = await searchCourts(
              {
                unitId: preferences.tennisCenter,
                date: slot.date,
                startHour: slot.time,
                duration: 1,
              },
              {
                email: preferences.email,
                userId: preferences.userId,
              }
            );

            // console.log(`[fetchCourts] Received availability for ${slot.time} (index ${actualIndex}):`, availability?.status);

            return { index: actualIndex, availability };
          });

          const batchResults = await Promise.all(batchPromises);

          if (isCancelled) {
            // console.log(`[fetchCourts] Cancelled after batch ${batchStart}-${batchEnd - 1}`);
            return;
          }

          // console.log(`[fetchCourts] Batch ${batchStart}-${batchEnd - 1} completed, results:`, batchResults.map(r => ({ index: r.index, time: slots[r.index]?.time, status: r.availability?.status })));

          // Collect suggested times from no-courts responses
          batchResults.forEach(({ availability }) => {
            if (availability?.status === "no-courts" && availability.suggestedTimes) {
              availability.suggestedTimes.forEach(time => allSuggestedTimes.add(time));
            }
          });

          // Update results with batch data
          // console.log(`[fetchCourts] Updating results for indices:`, batchResults.map(r => r.index));
          setResults((prevResults) => {
            const newResults = [...prevResults];
            batchResults.forEach(({ index, availability }) => {
              // console.log(`[fetchCourts] Setting index ${index} (${newResults[index]?.time}) to isLoading=false, status=${availability?.status}`);
              newResults[index] = {
                ...newResults[index],
                availability,
                isLoading: false,
              };
            });
            return newResults;
          });

          // Small delay between batches
          if (batchEnd < slots.length) {
            // console.log(`[fetchCourts] Waiting before next batch...`);
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }

        if (isCancelled) {
          // console.log(`[fetchCourts] Cancelled after all batches`);
          return;
        }

        // Now add suggested times after all original batches are complete
        if (allSuggestedTimes.size > 0) {
          const suggestedTimes = Array.from(allSuggestedTimes);
          // console.log(`[fetchCourts] All batches complete. Suggested times found:`, suggestedTimes);

          // Determine which times are new (not in the original slots)
          const initialTimeSet = new Set(slots.map(s => s.time));
          const newTimesToFetch = suggestedTimes.filter(time => !initialTimeSet.has(time));

          if (newTimesToFetch.length > 0) {
            // console.log(`[fetchCourts] Adding ${newTimesToFetch.length} new suggested slots:`, newTimesToFetch);

            // Update toast for suggested times
            await showToast({
              style: Toast.Style.Animated,
              title: "Checking additional slots",
              message: `Found ${newTimesToFetch.length} suggested time${newTimesToFetch.length > 1 ? 's' : ''}...`,
            });

            // Add new slots to the list with loading state
            setResults((prevResults) => {
              const existingTimes = new Set(prevResults.map(r => r.time));
              const newSlots: TimeSlotResult[] = [];

              newTimesToFetch.forEach(time => {
                if (!existingTimes.has(time)) {
                  newSlots.push({
                    dateTime: formatDisplayDateTime(selectedDate, time),
                    date: selectedDate,
                    time: time,
                    availability: null,
                    isLoading: true,
                  });
                }
              });

              if (newSlots.length > 0) {
                return [...prevResults, ...newSlots].sort((a, b) => {
                  // Sort by time
                  const [aH, aM] = a.time.split(':').map(Number);
                  const [bH, bM] = b.time.split(':').map(Number);
                  return (aH * 60 + aM) - (bH * 60 + bM);
                });
              }
              return prevResults;
            });

            // Fetch availability for newly added suggested slots
            // console.log(`[fetchCourts] Fetching availability for ${newTimesToFetch.length} suggested times`);
            for (const time of newTimesToFetch) {
              if (isCancelled) return;

              // console.log(`[fetchCourts] Fetching availability for suggested time: ${time}`);
              const availability = await searchCourts(
                {
                  unitId: preferences.tennisCenter,
                  date: selectedDate,
                  startHour: time,
                  duration: 1,
                },
                {
                  email: preferences.email,
                  userId: preferences.userId,
                }
              );

              // console.log(`[fetchCourts] Received availability for suggested time ${time}:`, availability?.status);

              if (!isCancelled) {
                setResults((prevResults) => {
                  const newResults = [...prevResults];
                  const index = newResults.findIndex(r => r.time === time);
                  if (index !== -1) {
                    newResults[index] = {
                      ...newResults[index],
                      availability,
                      isLoading: false,
                    };
                  }
                  return newResults;
                });
              }

              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }
          // console.log(`[fetchCourts] Finished fetching all suggested times`);
        }

        // console.log(`[fetchCourts] All batches completed. Final check of loading states...`);
        setResults((prevResults) => {
          const stillLoading = prevResults.filter(r => r.isLoading);
          if (stillLoading.length > 0) {
            console.warn(`[fetchCourts] WARNING: ${stillLoading.length} slots still loading:`, stillLoading.map(r => r.time));
            return prevResults;
          }

          // console.log(`[fetchCourts] All slots loaded successfully. Merging consecutive no-courts ranges...`);

          // Merge consecutive "no-courts" slots into ranges
          const merged: TimeSlotResult[] = [];
          let i = 0;

          while (i < prevResults.length) {
            const current = prevResults[i];

            // If not no-courts, add as-is
            if (current.availability?.status !== "no-courts") {
              merged.push(current);
              i++;
              continue;
            }

            // Find consecutive no-courts slots
            let endIndex = i;
            while (
              endIndex + 1 < prevResults.length &&
              prevResults[endIndex + 1]?.availability?.status === "no-courts"
            ) {
              endIndex++;
            }

            // If single slot or create range
            if (endIndex === i) {
              merged.push(current);
            } else {
              // Create range
              merged.push({
                ...current,
                isRangeStart: true,
                rangeEnd: prevResults[endIndex].time,
              });
            }

            i = endIndex + 1;
          }

          // console.log(`[fetchCourts] Merged ${prevResults.length} slots into ${merged.length} items`);
          return merged;
        });

        // All slots are loaded and merged, hide spinner
        setIsLoading(false);

        // Calculate available count and show success toast
        setResults((currentResults) => {
          const availableCount = currentResults.filter(r => r.availability?.status === "available").length;
          
          showToast({
            style: Toast.Style.Success,
            title: "Courts loaded",
            message: availableCount > 0 
              ? `Found ${availableCount} available time slot${availableCount > 1 ? 's' : ''}`
              : "No available slots found",
          });

          return currentResults;
        });

      } catch (error) {
        if (!isCancelled) {
          console.error("Error fetching courts:", error);
          showToast({
            style: Toast.Style.Failure,
            title: "Failed to fetch courts",
            message: error instanceof Error ? error.message : "Unknown error",
          });
          setIsLoading(false);
        }
      }
    }

    fetchCourts();

    return () => {
      // console.log(`[fetchCourts] Cleanup - cancelling fetch for ${selectedDate.toDateString()}`);
      isCancelled = true;
    };
  }, [selectedDate]);

  if (selectedTimeSlot) {
    return (
      <CourtsList
        slots={selectedTimeSlot.slots}
        time={selectedTimeSlot.time}
        date={selectedDate}
        onBack={() => setSelectedTimeSlot(null)}
      />
    );
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder={`${formatDateDisplay(selectedDate)}`}
      navigationTitle={formatDateDisplay(selectedDate)}>
      {results.filter((r) => r != null && r.time != null).map((result, index) => {
        const { availability, time, isLoading, isRangeStart, rangeEnd } = result;

        // Determine the status and accessories
        let icon: Icon;
        let iconTint: Color;
        let subtitle: string;
        let title: string = time;
        let accessories: List.Item.Accessory[] = [];

        if (isLoading) {
          icon = Icon.Circle;
          iconTint = Color.SecondaryText;
          subtitle = "Loading...";
        } else if (!availability) {
          icon = Icon.XMarkCircle;
          iconTint = Color.Red;
          subtitle = "Error";
        } else if (availability.status === "no-courts") {
          icon = Icon.XMarkCircle;
          iconTint = Color.Red;
          subtitle = "No courts available";

          // If it's a range, update the title
          if (isRangeStart && rangeEnd && rangeEnd !== time) {
            title = `${time} - ${rangeEnd}`;
          }
        } else {
          // Available courts
          icon = Icon.CheckCircle;
          iconTint = Color.Green;
          subtitle = `${availability.courts.length} available`;

          // Add court numbers as tags
          accessories = availability.courts.map((courtNum) => ({
            tag: { value: String(courtNum), color: Color.Green },
          }));
        }

        return (
          <List.Item
            key={index}
            icon={{ source: icon, tintColor: iconTint }}
            title={title}
            subtitle={subtitle}
            accessories={accessories}
            actions={
              availability && availability.status === "available" && availability.slots.length > 0 ? (
                <ActionPanel>
                  <Action
                    title="View Available Courts"
                    icon={Icon.List}
                    onAction={() => setSelectedTimeSlot({ slots: availability.slots, time })}
                  />
                </ActionPanel>
              ) : undefined
            }
            detail={
              <List.Item.Detail
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title="Time Slot" text={time} />
                    <List.Item.Detail.Metadata.Separator />

                    {availability && availability.status === "available" && availability.courts.length > 0 && (
                      <>
                        <List.Item.Detail.Metadata.Label title="Status" text="Available" />
                        <List.Item.Detail.Metadata.TagList title="Courts">
                          {availability.courts.map((courtNum) => (
                            <List.Item.Detail.Metadata.TagList.Item
                              key={courtNum}
                              text={String(courtNum)}
                              color={Color.Green}
                            />
                          ))}
                        </List.Item.Detail.Metadata.TagList>
                      </>
                    )}

                    {availability && availability.status === "no-courts" && (
                      <>
                        <List.Item.Detail.Metadata.Label title="Status" text="Fully Booked" />
                        <List.Item.Detail.Metadata.Label title="Note" text="All slots taken" />
                      </>
                    )}

                    {isLoading && <List.Item.Detail.Metadata.Label title="Status" text="Loading..." />}
                  </List.Item.Detail.Metadata>
                }
              />
            }
          />
        );
      })}
    </List>
  );
}

export default function Command() {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  if (selectedDate) {
    return <CourtsForDate selectedDate={selectedDate} />;
  }

  // Generate dates for the next 14 days
  const today = getToday();
  const dates = getNextDays(today, 14);

  return (
    <List searchBarPlaceholder="Choose a date...">
      {dates.map((date, index) => {
        const isToday = index === 0;
        const isTomorrow = index === 1;
        let title = formatDateDisplay(date);

        if (isToday) {
          title = `Today - ${title}`;
        } else if (isTomorrow) {
          title = `Tomorrow - ${title}`;
        }

        return (
          <List.Item
            key={index}
            icon={Icon.Calendar}
            title={title}
            actions={
              <ActionPanel>
                <Action title="Check Availability" onAction={() => setSelectedDate(date)} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
