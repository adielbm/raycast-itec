import { LocalStorage } from "@raycast/api";
import fetch from "node-fetch";

const BASE_URL = "https://center.tennis.org.il";
const STORAGE_KEY_TOKEN = "itec_auth_token";
const STORAGE_KEY_SESSION = "itec_session_id";

export interface AuthCredentials {
  email: string;
  userId: string;
}

export interface AuthTokens {
  authenticityToken: string;
  sessionId: string;
}

/**
 * Check if we need to login by testing the court invitation endpoint
 */
async function needsLogin(sessionId?: string): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (sessionId) {
      headers["Cookie"] = `_session_id=${sessionId}`;
    }

    const response = await fetch(`${BASE_URL}/self_services/court_invitation`, {
      method: "GET",
      headers,
      redirect: "manual",
    });

    // 302 means we need to login
    return response.status === 302;
  } catch (error) {
    console.error("Error checking login status:", error);
    return true;
  }
}

/**
 * Extract authenticity token from HTML page
 */
function extractAuthenticityToken(html: string): string | null {
  const match = html.match(/name="authenticity_token"\s+value="([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Extract session ID from cookie header
 */
function extractSessionId(setCookieHeader: string | string[] | undefined): string | null {
  if (!setCookieHeader) return null;

  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];

  for (const cookie of cookies) {
    const match = cookie.match(/_session_id=([^;]+)/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Get authenticity token from the login page
 */
async function getAuthenticityTokenFromLoginPage(): Promise<string | null> {
  try {
    const response = await fetch(`${BASE_URL}/self_services/login`);
    const html = await response.text();
    return extractAuthenticityToken(html);
  } catch (error) {
    console.error("Error fetching login page:", error);
    return null;
  }
}

/**
 * Perform login and get auth tokens
 */
async function performLogin(credentials: AuthCredentials): Promise<AuthTokens | null> {
  try {
    // First, get the authenticity token from the login page
    const authenticityToken = await getAuthenticityTokenFromLoginPage();
    if (!authenticityToken) {
      throw new Error("Failed to get authenticity token");
    }

    // Prepare form data
    const formData = new URLSearchParams();
    formData.append("utf8", "✓");
    formData.append("authenticity_token", authenticityToken);
    formData.append("login", credentials.email);
    formData.append("p_id", credentials.userId);

    // Perform login
    const response = await fetch(`${BASE_URL}/self_services/login.js`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
      redirect: "manual",
    });

    // Extract session ID from cookies
    const setCookie = response.headers.get("set-cookie");
    const sessionId = extractSessionId(setCookie || undefined);

    if (!sessionId) {
      throw new Error("Failed to get session ID from login response");
    }

    // Get a fresh authenticity token for subsequent requests
    const courtInvitationResponse = await fetch(`${BASE_URL}/self_services/court_invitation`, {
      headers: {
        Cookie: `_session_id=${sessionId}`,
      },
    });

    const html = await courtInvitationResponse.text();
    const newAuthenticityToken = extractAuthenticityToken(html);

    if (!newAuthenticityToken) {
      // If we can't extract a new token, use the login one
      return {
        authenticityToken,
        sessionId,
      };
    }

    return {
      authenticityToken: newAuthenticityToken,
      sessionId,
    };
  } catch (error) {
    console.error("Login error:", error);
    return null;
  }
}

/**
 * Get stored auth tokens from local storage
 */
async function getStoredTokens(): Promise<AuthTokens | null> {
  try {
    const token = await LocalStorage.getItem<string>(STORAGE_KEY_TOKEN);
    const session = await LocalStorage.getItem<string>(STORAGE_KEY_SESSION);

    if (token && session) {
      return {
        authenticityToken: token,
        sessionId: session,
      };
    }
  } catch (error) {
    console.error("Error reading stored tokens:", error);
  }

  return null;
}

/**
 * Store auth tokens in local storage
 */
async function storeTokens(tokens: AuthTokens): Promise<void> {
  try {
    await LocalStorage.setItem(STORAGE_KEY_TOKEN, tokens.authenticityToken);
    await LocalStorage.setItem(STORAGE_KEY_SESSION, tokens.sessionId);
  } catch (error) {
    console.error("Error storing tokens:", error);
  }
}

/**
 * Clear stored auth tokens
 */
async function clearStoredTokens(): Promise<void> {
  try {
    await LocalStorage.removeItem(STORAGE_KEY_TOKEN);
    await LocalStorage.removeItem(STORAGE_KEY_SESSION);
  } catch (error) {
    console.error("Error clearing tokens:", error);
  }
}

/**
 * Get valid auth tokens, performing login if necessary
 */
export async function getAuthTokens(credentials: AuthCredentials): Promise<AuthTokens | null> {
  // Try to get stored tokens
  let tokens = await getStoredTokens();

  if (tokens) {
    // Check if we need to re-login
    const shouldLogin = await needsLogin(tokens.sessionId);

    if (!shouldLogin) {
      // Tokens are still valid
      return tokens;
    }

    // Tokens expired, clear them
    await clearStoredTokens();
  }

  // Perform login to get new tokens
  tokens = await performLogin(credentials);

  if (tokens) {
    // Store the new tokens
    await storeTokens(tokens);
    return tokens;
  }

  return null;
}

/**
 * Force a fresh login (useful for testing or token refresh)
 */
export async function refreshAuthTokens(credentials: AuthCredentials): Promise<AuthTokens | null> {
  await clearStoredTokens();
  return getAuthTokens(credentials);
}
