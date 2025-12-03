import { List, getPreferenceValues, showToast, Toast, Icon, Color, Action, ActionPanel, confirmAlert } from "@raycast/api";
import { useState, useEffect } from "react";
import { fetchMyRents, cancelRent } from "./services/api";
import { parseMyRents, Rental } from "./utils/parser";
import { isFutureDate, getWeekday } from "./utils/date";

interface Preferences {
  email: string;
  userId: string;
}

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  async function loadRentals() {
    try {
      const html = await fetchMyRents({
        email: preferences.email,
        userId: preferences.userId,
      });

      if (!html) {
        throw new Error("Failed to fetch rentals");
      }

      // Parse all rentals
      const allRentals = parseMyRents(html);

      // Filter to show only future rentals
      const futureRentals = allRentals.filter((rental) => isFutureDate(rental.dateObj));

      // Sort by date (earliest first)
      futureRentals.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());

      setRentals(futureRentals);
    } catch (error) {
      console.error("Error loading rentals:", error);
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to load rentals",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadRentals();
  }, [preferences.email, preferences.userId]);

  async function handleCancelRental(rental: Rental) {
    if (!rental.allocationId) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Cannot cancel",
        message: "This rental cannot be cancelled (too close to start time)",
      });
      return;
    }

    const confirmed = await confirmAlert({
      title: "Cancel Rental",
      message: `Are you sure you want to cancel your rental on ${rental.date} at ${rental.time}?`,
      primaryAction: {
        title: "Cancel Rental",
      },
    });

    if (!confirmed) {
      return;
    }

    setIsLoading(true);

    try {
      const success = await cancelRent(rental.allocationId, {
        email: preferences.email,
        userId: preferences.userId,
      });

      if (success) {
        await showToast({
          style: Toast.Style.Success,
          title: "Rental cancelled",
          message: "Your rental has been successfully cancelled",
        });

        // Refresh the list to confirm cancellation
        await loadRentals();
      } else {
        throw new Error("Failed to cancel rental");
      }
    } catch (error) {
      console.error("Error canceling rental:", error);
      await showToast({
        style: Toast.Style.Failure,
        title: "Cancellation failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
      setIsLoading(false);
    }
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search your upcoming rentals...">
      {rentals.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Calendar}
          title="No Upcoming Rentals"
          description="You don't have any future court rentals scheduled."
        />
      ) : (
        rentals.map((rental, index) => {
          const weekday = getWeekday(rental.dateObj);
          const title = `${weekday}, ${rental.date}`;

          return (
            <List.Item
              key={index}
              icon={{ source: Icon.Calendar, tintColor: Color.Green }}
              title={title}
              subtitle={rental.time}
              accessories={[
                { tag: { value: rental.court, color: Color.Blue } },
                rental.allocationId
                  ? { icon: { source: Icon.XMarkCircle, tintColor: Color.Red }, tooltip: "Can be cancelled" }
                  : { icon: { source: Icon.Lock, tintColor: Color.SecondaryText }, tooltip: "Cannot be cancelled" },
              ]}
              actions={
                rental.allocationId ? (
                  <ActionPanel>
                    <Action
                      title="Cancel Rental"
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      onAction={() => handleCancelRental(rental)}
                    />
                  </ActionPanel>
                ) : undefined
              }
            />
          );
        })
      )}
    </List>
  );
}
