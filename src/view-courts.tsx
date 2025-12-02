import { List, getPreferenceValues, showToast, Toast, Color, Icon, Action, ActionPanel, Cache } from "@raycast/api";
import { useState, useEffect } from "react";
import { searchCourts, fetchTimeSlots } from "./services/api";
import { getToday, getNextDays, generateTimeSlotsForDate, formatDisplayDateTime, formatDateDisplay } from "./utils/date";
import { CourtAvailability } from "./utils/parser";

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

function CourtsForDate({ selectedDate }: { selectedDate: Date }) {
  const preferences = getPreferenceValues<Preferences>();
  const [results, setResults] = useState<TimeSlotResult[]>([]);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  useEffect(() => {
    async function fetchCourts() {
      try {
        console.log(`[fetchCourts] Starting for date: ${selectedDate.toDateString()}, center: ${preferences.tennisCenter}`);
        
        // First, fetch available time slots for this unit and date
        const availableTimeSlots = await fetchTimeSlots(
          preferences.tennisCenter,
          selectedDate,
          {
            email: preferences.email,
            userId: preferences.userId,
          }
        );

        console.log(`[fetchCourts] Received ${availableTimeSlots.length} time slots from API:`, availableTimeSlots);

        // Generate time slots for the selected date using fetched slots
        const slots = generateTimeSlotsForDate(selectedDate, availableTimeSlots);
        console.log(`[fetchCourts] Generated ${slots.length} slots for display:`, slots);

        // Initialize results with loading state
        const initialResults: TimeSlotResult[] = slots.map((slot) => ({
          dateTime: formatDisplayDateTime(slot.date, slot.time),
          date: slot.date,
          time: slot.time,
          availability: null,
          isLoading: true,
        }));

        setResults(initialResults);
        setIsInitialLoad(false);

        // Fetch availability in batches of 5
        const batchSize = 5;
        for (let batchStart = 0; batchStart < slots.length; batchStart += batchSize) {
          const batchEnd = Math.min(batchStart + batchSize, slots.length);
          const batchSlots = slots.slice(batchStart, batchEnd);

          // Process batch in parallel
          const batchPromises = batchSlots.map(async (slot, batchIndex) => {
            const actualIndex = batchStart + batchIndex;
            const cacheKey = `reserved_${formatDisplayDateTime(slot.date, slot.time)}_${preferences.tennisCenter}`;

            // Check cache for reserved status
            if (reservedCache.has(cacheKey)) {
              return {
                index: actualIndex,
                availability: {
                  status: "reserved" as const,
                  courts: [],
                  slots: [],
                },
              };
            }

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

            // Cache reserved status
            if (availability?.status === "reserved") {
              reservedCache.set(cacheKey, "true");
            }

            return { index: actualIndex, availability };
          });

          const batchResults = await Promise.all(batchPromises);

          // Update results with batch data
          setResults((prevResults) => {
            const newResults = [...prevResults];
            batchResults.forEach(({ index, availability }) => {
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
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }

        // Consolidate continuous reserved ranges (only after all slots are loaded)
        setResults((prevResults) => {
          // Check if all results are loaded
          const allLoaded = prevResults.every((r) => !r.isLoading);
          if (!allLoaded || prevResults.length === 0) {
            return prevResults;
          }

          const consolidated: TimeSlotResult[] = [];

          // Single pass grouping without out-of-bounds access
          let startIndex = 0;
          while (startIndex < prevResults.length) {
            const current = prevResults[startIndex];

            if (current?.availability?.status !== "reserved") {
              consolidated.push(current);
              startIndex++;
              continue;
            }

            // We are at the beginning of a reserved run
            let endIndex = startIndex;
            while (
              endIndex + 1 < prevResults.length &&
              prevResults[endIndex + 1]?.availability?.status === "reserved"
            ) {
              endIndex++;
            }

            if (endIndex === startIndex) {
              // Single reserved slot, keep as-is
              consolidated.push(current);
            } else {
              // Consolidated reserved range
              const rangeEndTime = prevResults[endIndex]?.time ?? current.time;
              consolidated.push({
                ...current,
                isRangeStart: true,
                rangeEnd: rangeEndTime,
              });
            }

            startIndex = endIndex + 1;
          }

          return consolidated;
        });
      } catch (error) {
        console.error("Error fetching courts:", error);
        showToast({
          style: Toast.Style.Failure,
          title: "Failed to fetch courts",
          message: error instanceof Error ? error.message : "Unknown error",
        });
        setIsInitialLoad(false);
      }
    }

    fetchCourts();
  }, [selectedDate]);

  return (
    <List isLoading={isInitialLoad} searchBarPlaceholder={`${formatDateDisplay(selectedDate)}`}
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
          icon = Icon.QuestionMark;
          iconTint = Color.SecondaryText;
          subtitle = "Loading...";
        } else if (!availability) {
          icon = Icon.XMarkCircle;
          iconTint = Color.Red;
          subtitle = "Error";
        } else if (availability.status === "reserved") {
          icon = Icon.Lock;
          iconTint = Color.SecondaryText;
          if (isRangeStart && rangeEnd && rangeEnd !== time) {
            title = `${time} - ${rangeEnd}`;
            subtitle = "Unavailable";
            accessories = [{ tag: { value: "Reserved", color: Color.SecondaryText } }];
          } else {
            subtitle = "Unavailable";
            accessories = [{ tag: { value: "Reserved", color: Color.SecondaryText } }];
          }
        } else if (availability.status === "no-courts") {
          icon = Icon.XMarkCircle;
          iconTint = Color.Red;
          subtitle = "Fully Booked";
          accessories = [{ tag: { value: "Booked", color: Color.Red } }];
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

                    {availability && availability.status === "reserved" && (
                      <>
                        <List.Item.Detail.Metadata.Label title="Status" text="Unavailable" />
                        <List.Item.Detail.Metadata.Label title="Note" text="Reserved for events" />
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
