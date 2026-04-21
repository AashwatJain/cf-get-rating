# CF Get Rating — Chrome Extension

A Chrome extension that shows Codeforces problem ratings and tags directly on the problem page.

## Features

- **Rating always visible** in the sidebar — replaces the native tags section
- **Toggle tags** with a "Show All Tags" button
- **Contest Standings** link
- **Popup** — click the extension icon to see rating + tags
- Matches Codeforces native UI styling

## Installation

1. Clone this repo
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the cloned folder

## How it works

- Parses the problem URL to extract contest ID and problem index
- Fetches data from Codeforces API (`contest.standings` with `problemset.problems` fallback)
- Injects a widget in the right sidebar replacing the native tags section
- Rating is always visible, tags are toggled via button

## Screenshots

_Coming soon_

## Tech Stack

- Manifest V3
- Vanilla JavaScript
- Codeforces API
