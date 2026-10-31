# Salesforce Debug Log Viewer

A modern, interactive tool for visualizing and analyzing Salesforce Apex debug logs. This application provides a rich user interface to explore logs with timeline views, sequence diagrams, and hierarchical tree structures.

## Features

### Org Connection
- **Automatic Detection**: Automatically detects Salesforce orgs authenticated via the Salesforce CLI (`sf`).
- **One-Click Connect**: Connect to any authenticated org to list and download logs.

### Log Management
- **List Logs**: View available `ApexLog` records from the connected org.
- **Filter & Search**: Quickly find logs by user, operation, status, etc.
- **Download**: Fetch and parse raw log bodies.
- **Drag & Drop**: Analyze local `.log` files by dragging them onto the window.

### Visualization Modes
- **Timeline View**: Visual representation of execution time and event duration.
- **Sequence Diagram**: Generates a UML sequence diagram to visualize call stacks and interactions.
- **Tree View**: Hierarchical collapse/expand view of the execution stack, with self/total durations per frame.
- **Event List**: Detailed chronological list of log events.

### Analysis Tools
- **Category Filtering**: Filter events by category (e.g., `Apex_Code`, `SOQL_Execute`, `Callout`) to reduce noise.
- **Search**: Full-text search within log events for specific variable names or error messages.
- **Detail Panel**: Inspect deep properties of selected events.
- **Performance Stats**: View total duration, event counts, and other metrics.

## Log Parsing

The event list, timeline, filters and sequence diagram use the app's own line parser ([src/logParser.ts](src/logParser.ts)).

The **Tree View** is built with [`@apexdevtools/apex-log-parser`](https://www.npmjs.com/package/@apexdevtools/apex-log-parser) (BSD-3-Clause), the parser behind Certinia's [Apex Log Analyzer](https://github.com/certinia/debug-log-analyzer). It parses each log in the browser and provides the call nesting and nanosecond durations; [src/apexLogTree.ts](src/apexLogTree.ts) maps its events onto the app's events. The package is pre-1.0, so its version is pinned in `package.json`.

## Prerequisites

Before running the application, ensure you have the following installed:

1.  **Node.js** (v18 or higher)
2.  **Salesforce CLI (`sf`)**
    -   Install via `npm install -g @salesforce/cli` or the [official installer](https://developer.salesforce.com/tools/salesforcecli).
    -   Authenticate to your target orgs using `sf org login web` (or other auth methods).

## Installation

1.  Clone the repository:
    ```bash
    git clone <repository_url>
    cd debug_logs_viewer
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

## Running the Application

Start both the backend server and frontend client with a single command:

```bash
npm run dev
```

This will launch:
-   **Backend Server** (Express) on `http://localhost:3001` - Handles Salesforce CLI interactions.
-   **Frontend Client** (Vite/React) commonly on `http://localhost:5173`.

## Usage Guide

1.  **Connect to an Org**:
    -   On the left sidebar, click "Connect" next to the desired Salesforce organization.
    -   The app uses your local `sf` CLI configuration to authenticate.

2.  **Load Logs**:
    -   Once connected, recent debug logs appear in the "Available Logs" section.
    -   Click a log to download and parse it.
    -   **Tip**: Drag and drop a raw `.log` file into the window to view it without connecting to an org.

3.  **Explore Data**:
    -   Use the **Toolbar** buttons to toggle views:
        -   **List**: Standard chronological view.
        -   **Tree**: Nested call stack view.
        -   **Diagram**: Sequence diagram of method calls.
    -   **Filter**: Use the search bar to find text.
    -   **Categories**: Toggle categories on the right sidebar to hide irrelevent events (e.g., hidden `SYSTEM_METHOD_ENTRY`).

## Troubleshooting

-   **Failed to list orgs**: Ensure `sf` is in your system PATH and you can run `sf org list` in your terminal.
-   **Connection Failed**: The local server uses the `sf` CLI to obtain an access token. Ensure your session is valid by running `sf org auth show-access-token -o <alias>` in your terminal. (Salesforce CLI 2.141+ no longer returns the token from `sf org display`.)
