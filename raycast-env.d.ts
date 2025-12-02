/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Tennis Center - Select your preferred tennis center */
  "tennisCenter": "12" | "8" | "11" | "40" | "5" | "9" | "3" | "14" | "7" | "46" | "37" | "15" | "16" | "6" | "10" | "4" | "2" | "13",
  /** Email - Your ITEC account email */
  "email": string,
  /** ID Number - Your Israeli ID number */
  "userId": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `view-courts` command */
  export type ViewCourts = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `view-courts` command */
  export type ViewCourts = {}
}

