import puppeteer, { Browser, Page } from "puppeteer-core";
import { showToast, Toast, getPreferenceValues } from "@raycast/api";
import { formatDate } from "../utils/date";
import { AuthCredentials, getAuthTokens } from "./auth";

const BASE_URL = "https://center.tennis.org.il";

interface Preferences {
  tennisCenter: string;
  email: string;
  userId: string;
  chromePath?: string;
}

export interface BookingParams {
  unitId: string; // Tennis center ID
  courtId: number;
  courtNumber: number;
  date: Date;
  startHour: string; // Format: HH:mm
  duration: number; // 1, 1.5, 2, or 3
}

/**
 * Get the Chrome/Chromium executable path
 */
function getChromePath(): string {
  const preferences = getPreferenceValues<Preferences>();
  
  // If user provided a custom path, use it
  if (preferences.chromePath) {
    return preferences.chromePath;
  }

  // Default paths for macOS
  const defaultPaths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];

  // Return first existing path
  const fs = require("fs");
  for (const path of defaultPaths) {
    if (fs.existsSync(path)) {
      return path;
    }
  }

  throw new Error("Chrome/Chromium not found. Please specify chromePath in preferences.");
}

/**
 * Launch browser with authentication
 */
async function launchBrowser(credentials: AuthCredentials): Promise<{ browser: Browser; page: Page } | null> {
  try {
    const tokens = await getAuthTokens(credentials);
    if (!tokens) {
      throw new Error("Failed to authenticate");
    }

    const browser = await puppeteer.launch({
      executablePath: getChromePath(),
      headless: true,
      defaultViewport: { width: 1280, height: 800 },
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    // Set the session cookie so we're already logged in
    await browser.setCookie({
      name: "_session_id",
      value: tokens.sessionId,
      domain: "center.tennis.org.il",
      path: "/",
      httpOnly: true,
      secure: true,
    });

    return { browser, page };
  } catch (error) {
    console.error("Error launching browser:", error);
    return null;
  }
}

/**
 * Fill and submit step 1 (court search form)
 */
async function fillStep1(page: Page, params: BookingParams): Promise<boolean> {
  try {
    await page.goto(`${BASE_URL}/self_services/court_invitation`, {
      waitUntil: "networkidle2",
    });

    // Check if we're already at step 3 (court reserved from previous attempt)
    const alreadyAtStep3 = await page.evaluate(() => {
      const step3 = (globalThis as any).document?.querySelector("#step-3");
      if (!step3) return false;
      const style = window.getComputedStyle(step3);
      return style.display !== "none";
    });

    if (alreadyAtStep3) {
      console.log("Already at step 3, skipping form fill");
      return true;
    }

    // Wait for form to be visible
    await page.waitForSelector("#form", { timeout: 10000 });

    // Wait for all form elements to be ready
    await page.waitForSelector("#search_unit_id", { timeout: 5000 });
    await page.waitForSelector("#search_court_type", { timeout: 5000 });
    await page.waitForSelector("#search_start_date", { timeout: 5000 });

    // Select tennis center
    await page.select("#search_unit_id", params.unitId);
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Select court type (always 1 for tennis)
    await page.select("#search_court_type", "1");
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Clear and fill in the date
    const dateStr = formatDate(params.date); // DD/MM/YYYY
    await page.click("#search_start_date", { clickCount: 3 }); // Select all
    await page.keyboard.press("Backspace");
    await page.type("#search_start_date", dateStr, { delay: 100 });
    
    // Trigger change event and wait for hour options to load
    await page.evaluate(`
      const dateInput = document.querySelector("#search_start_date");
      if (dateInput) {
        dateInput.dispatchEvent(new Event("change", { bubbles: true }));
        dateInput.dispatchEvent(new Event("blur", { bubbles: true }));
      }
    `);

    // Wait longer for the hour dropdown to populate
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Wait for the hour select to be available and populated with options
    await page.waitForFunction(
      `() => {
        const select = document.querySelector("#search_start_hour");
        if (!select) return false;
        
        const hasOptions = select.options.length > 1;
        const isEnabled = !select.disabled;
        
        console.log('Hour select: ' + select.options.length + ' options, enabled: ' + isEnabled);
        return hasOptions && isEnabled;
      }`,
      { timeout: 10000, polling: 500 }
    );

    // Log available hours for debugging and choose a valid one
    const { availableHours, selectedHour } = await page.evaluate(
      (preferredHour) => {
        const select = (globalThis as any).document?.querySelector("#search_start_hour") as any;
        if (!select) {
          return { availableHours: [] as string[], selectedHour: null as string | null };
        }

        const values = Array.from(select.options as any)
          .map((opt: any) => opt.value as string)
          .filter((v) => v);

        let hourToSelect: string | null = null;

        if (preferredHour && values.includes(preferredHour)) {
          hourToSelect = preferredHour;
        } else {
          const sorted = values
            .slice()
            .sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
          hourToSelect = sorted[0] ?? null;
        }

        if (hourToSelect) {
          select.value = hourToSelect;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }

        return { availableHours: values, selectedHour: hourToSelect };
      },
      params.startHour
    );

    console.log("Available hours:", availableHours);
    console.log("Selected hour:", selectedHour);

    if (!selectedHour) {
      throw new Error("No available hours to select");
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Select duration and trigger change event
    await page.select("#search_duration", params.duration.toString());
    await page.evaluate(`
      const durationSelect = document.querySelector("#search_duration");
      if (durationSelect) {
        durationSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    `);
    console.log(`Selected duration: ${params.duration}`);
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Wait for submit button to be enabled/clickable
    await page.waitForFunction(
      `() => {
        const btn = document.querySelector("#step1-submit-btn");
        return btn && !btn.disabled && btn.offsetParent !== null;
      }`,
      { timeout: 5000 }
    );

    console.log("Clicking submit button...");
    
    // Click submit button (form might use AJAX, not traditional navigation)
    await page.click("#step1-submit-btn");

    // Wait for step 2 to load (the results appear on the same page via AJAX)
    await page.waitForSelector(".court_invitations_list", { timeout: 15000 });

    return true;
  } catch (error) {
    console.error("Error in step 1:", error);
    
    // Take a screenshot for debugging
    try {
      await page.screenshot({ path: "/tmp/step1-error.png" });
      console.log("Screenshot saved to /tmp/step1-error.png");
    } catch (screenshotError) {
      // Ignore screenshot errors
    }
    
    return false;
  }
}

/**
 * Select court in step 2
 */
async function selectCourtInStep2(page: Page, params: BookingParams): Promise<boolean> {
  try {
    // Check if we're already at step 3 (court reserved from previous attempt)
    const alreadyAtStep3 = await page.evaluate(() => {
      const step3 = (globalThis as any).document?.querySelector("#step-3");
      if (!step3) return false;
      const style = window.getComputedStyle(step3);
      return style.display !== "none";
    });

    if (alreadyAtStep3) {
      console.log("Already at step 3, skipping court selection");
      return true;
    }

    // Wait for the court list to be visible
    await page.waitForSelector(".court_invitations_list", { timeout: 10000 });

    // Try to click the appropriate court button inside the list.
    // Prefer specific courtId when possible; otherwise, click first available.
    const clickResult = await page.evaluate(
      (preferredCourtId) => {
        const doc = (globalThis as any).document as Document | undefined;
        if (!doc) {
          return { clicked: false, reason: "no-document" };
        }

        const container = doc.querySelector(".court_invitations_list") as HTMLElement | null;
        if (!container) {
          return { clicked: false, reason: "no-container" };
        }

        const buttons = Array.from(
          container.querySelectorAll("a.btn-choose") as NodeListOf<HTMLAnchorElement>
        );

        const hrefs = buttons.map((b) => b.getAttribute("href") || "");

        if (!buttons.length) {
          return { clicked: false, reason: "no-buttons", hrefs };
        }

        let target: HTMLAnchorElement | null = null;

        if (preferredCourtId) {
          target =
            buttons.find((b) => {
              const href = b.getAttribute("href") || "";
              return href.includes(`court_id=${preferredCourtId}`);
            }) || null;
        }

        if (!target) {
          target = buttons[0] || null;
        }

        if (!target) {
          return { clicked: false, reason: "no-target", hrefs };
        }

        try {
          target.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
        } catch (_) {
          // ignore scroll errors
        }

        try {
          target.click();
          return { clicked: true, reason: "ok", hrefs };
        } catch (e) {
          return { clicked: false, reason: "click-error", hrefs };
        }
      },
      params.courtId
    );

    console.log("Step 2 court buttons hrefs:", clickResult.hrefs);
    console.log("Step 2 click result:", clickResult);

    if (!clickResult.clicked) {
      throw new Error(`Failed to click court button: ${clickResult.reason}`);
    }

    // Give page a moment to transition after click
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check what's on the page now
    const pageState = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      return {
        hasStep2: !!doc.querySelector("#step-2"),
        step2Display: doc.querySelector("#step-2")?.style?.display || "unknown",
        hasStep3: !!doc.querySelector("#step-3"),
        step3Display: doc.querySelector("#step-3")?.style?.display || "unknown",
        hasStep4: !!doc.querySelector("#step-4"),
        step4Display: doc.querySelector("#step-4")?.style?.display || "unknown",
        hasPanelOrderDetails: !!doc.querySelector(".panel-order-details"),
        visibleSteps: Array.from(doc.querySelectorAll("[id^='step-']")).map((el: any) => ({
          id: el.id,
          display: window.getComputedStyle(el).display,
        })),
      };
    });

    console.log("Page state after court click:", pageState);

    // Wait for step 3 to load - check for either step-3 div or order details panel
    await page.waitForFunction(
      () => {
        const doc = (globalThis as any).document;
        if (!doc) return false;
        
        const step3 = doc.querySelector("#step-3");
        if (step3 && window.getComputedStyle(step3).display !== "none") {
          return true;
        }
        
        const panel = doc.querySelector(".panel-order-details");
        return panel && window.getComputedStyle(panel).display !== "none";
      },
      { timeout: 10000 }
    );

    return true;
  } catch (error) {
    console.error("Error in step 2:", error);
    return false;
  }
}

/**
 * Confirm booking in step 3
 */
async function confirmStep3(page: Page): Promise<boolean> {
  try {
    // Wait for step 3 to be visible
    await page.waitForFunction(
      () => {
        const doc = (globalThis as any).document;
        if (!doc) return false;
        
        const step3 = doc.querySelector("#step-3");
        if (step3 && window.getComputedStyle(step3).display !== "none") {
          return true;
        }
        
        const panel = doc.querySelector(".panel-order-details");
        return panel && window.getComputedStyle(panel).display !== "none";
      },
      { timeout: 10000 }
    );

    // Try to find and click a suitable "Next" button in step 3 area.
    const clickResult = await page.evaluate(() => {
      const doc = (globalThis as any).document as Document | undefined;
      if (!doc) return { clicked: false, reason: "no-document", candidates: [] as string[] };

      // Try to find buttons in either #step-3 or .panel-order-details
      let container = doc.querySelector("#step-3") as HTMLElement | null;
      if (!container || window.getComputedStyle(container).display === "none") {
        container = doc.querySelector(".panel-order-details") as HTMLElement | null;
      }
      
      if (!container) return { clicked: false, reason: "no-container", candidates: [] as string[] };

      const buttons = Array.from(
        container.querySelectorAll("a.btn-blue, button.btn-blue, a.btn, button.btn") as
          NodeListOf<HTMLAnchorElement | HTMLButtonElement>
      );

      const candidates = buttons.map((b) => {
        const tag = b.tagName.toLowerCase();
        const text = (b.textContent || "").trim();
        const href = (b as HTMLAnchorElement).getAttribute?.("href") || "";
        return `${tag}:${text}:${href}`;
      });

      if (!buttons.length) {
        return { clicked: false, reason: "no-buttons", candidates };
      }

      // Prefer a button with a complete_invitation href, else fall back to first.
      let target =
        (buttons.find((b) => {
          const href = (b as HTMLAnchorElement).getAttribute?.("href") || "";
          return href.includes("/self_services/complete_invitation");
        }) as HTMLElement | undefined) || (buttons[0] as HTMLElement);

      if (!target) {
        return { clicked: false, reason: "no-target", candidates };
      }

      try {
        target.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
      } catch {
        // ignore
      }

      try {
        target.click();
        return { clicked: true, reason: "ok", candidates };
      } catch {
        return { clicked: false, reason: "click-error", candidates };
      }
    });

    console.log("Step 3 next-button candidates:", clickResult.candidates);
    console.log("Step 3 click result:", clickResult);

    if (!clickResult.clicked) {
      throw new Error(`Failed to click next button in step 3: ${clickResult.reason}`);
    }

    // Wait for step 4 (confirmation) to load
    await page.waitForSelector("#step-4", { timeout: 15000 });

    return true;
  } catch (error) {
    console.error("Error in step 3:", error);
    return false;
  }
}

/**
 * Verify step 4 (success confirmation)
 */
async function verifyStep4(page: Page): Promise<boolean> {
  try {
    // Wait for step 4 to be visible
    await page.waitForFunction(
      () => {
        const doc = (globalThis as any).document;
        if (!doc) return false;
        
        const step4 = doc.querySelector("#step-4");
        return step4 && window.getComputedStyle(step4).display !== "none";
      },
      { timeout: 10000 }
    );

    // Check what's in step 4
    const step4Content = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const step4 = doc.querySelector("#step-4");
      
      return {
        hasAlertSuccess: !!doc.querySelector(".alert-success"),
        hasAlertDanger: !!doc.querySelector(".alert-danger"),
        hasAlertWarning: !!doc.querySelector(".alert-warning"),
        allAlerts: Array.from(doc.querySelectorAll(".alert")).map((el: any) => ({
          className: el.className,
          text: (el.textContent || "").trim().substring(0, 200),
        })),
        step4Text: step4 ? (step4.textContent || "").trim().substring(0, 300) : "",
        step4HTML: step4 ? step4.innerHTML.substring(0, 500) : "",
      };
    });

    console.log("Step 4 content:", step4Content);

    // Check for success indicators
    const hasSuccess =
      step4Content.hasAlertSuccess ||
      step4Content.step4Text.includes("הזמנת המגרש בוצעה בהצלחה") ||
      step4Content.step4Text.includes("בוצעה בהצלחה") ||
      step4Content.step4Text.includes("success");

    const hasError =
      step4Content.hasAlertDanger ||
      step4Content.hasAlertWarning ||
      step4Content.step4Text.includes("שגיאה") ||
      step4Content.step4Text.includes("error");

    if (hasError) {
      console.error("Step 4 shows error:", step4Content.step4Text);
      return false;
    }

    return hasSuccess;
  } catch (error) {
    console.error("Error in step 4:", error);
    return false;
  }
}

/**
 * Main function to automate court booking
 */
export async function bookCourtAutomatically(params: BookingParams): Promise<boolean> {
  const preferences = getPreferenceValues<Preferences>();
  const credentials: AuthCredentials = {
    email: preferences.email,
    userId: preferences.userId,
  };

  let browser: Browser | null = null;

  try {
    // Show initial toast
    await showToast({
      style: Toast.Style.Animated,
      title: "Starting automation...",
      message: "Opening browser",
    });

    // Launch browser
    const result = await launchBrowser(credentials);
    if (!result) {
      throw new Error("Failed to launch browser");
    }

    browser = result.browser;
    const page = result.page;

    // Step 1: Fill search form
    await showToast({
      style: Toast.Style.Animated,
      title: "Step 1/4",
      message: "Filling search form...",
    });

    const step1Success = await fillStep1(page, params);
    if (!step1Success) {
      throw new Error("Failed to complete step 1");
    }

    // Step 2: Select court
    await showToast({
      style: Toast.Style.Animated,
      title: "Step 2/4",
      message: `Selecting court ${params.courtNumber}...`,
    });

    const step2Success = await selectCourtInStep2(page, params);
    if (!step2Success) {
      throw new Error("Failed to complete step 2");
    }

    // Step 3: Confirm booking
    await showToast({
      style: Toast.Style.Animated,
      title: "Step 3/4",
      message: "Confirming booking...",
    });

    const step3Success = await confirmStep3(page);
    if (!step3Success) {
      throw new Error("Failed to complete step 3");
    }

    // Step 4: Verify success
    await showToast({
      style: Toast.Style.Animated,
      title: "Step 4/4",
      message: "Verifying booking...",
    });

    const step4Success = await verifyStep4(page);
    if (!step4Success) {
      throw new Error("Failed to verify booking success");
    }

    // Success!
    await showToast({
      style: Toast.Style.Success,
      title: "Booking completed!",
      message: `Court ${params.courtNumber} booked successfully`,
    });

    // Keep browser open for a few seconds so user can see the confirmation
    await new Promise((resolve) => setTimeout(resolve, 3000));

    return true;
  } catch (error) {
    console.error("Automation error:", error);

    await showToast({
      style: Toast.Style.Failure,
      title: "Booking failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });

    // Keep browser open on error so user can see what went wrong
    if (browser) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    return false;
  } finally {
    // Close browser
    if (browser) {
      await browser.close();
    }
  }
}
