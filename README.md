# OneClickInstall

[![Maintained with Love](https://img.shields.io/badge/Maintained%20with-Love-blue.svg)](https://github.com/Balmukund-Maurya/OneClickInstall)
[![Electron](https://img.shields.io/badge/Electron-33.0.0-47848F.svg?logo=electron)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18.0.0-61DAFB.svg?logo=react)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6.svg?logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**OneClickInstall** is a powerful, cross-platform desktop application designed to simplify software deployment for developers and power users. With a sleek, modern UI and robust automation, it allows you to install, uninstall, and manage your essential tools in bulk with just one click.

> **Note:** Currently optimized for **macOS** (via Homebrew) and **Windows** (via Winget). Linux support is on the roadmap.

---

## Features

- **Bulk Installation**: Select multiple apps (VS Code, Docker, Node.js, etc.) and install them all at once.
- **Cross-Platform**: Seamlessly works on macOS and Windows with native package managers (`brew` & `winget`).
- **Modern UI**:
  - **Light & Dark Mode**: Beautiful, adaptive themes with a transparent, glass-morphism aesthetic.
  - **Responsive Design**: Resizable, collapsible sidebar and adaptive layouts.
  - **Command Center**: Real-time terminal logs with color-coded feedback and progress tracking.
- **Smart Catalog**: Curated list of 100+ essential developer tools, categorized for easy discovery.
- **Robust Error Handling**:
  - **Auto-Retry**: Automatically retries failed downloads or network hiccups.
  - **Conflict Resolution**: Handles linking issues and existing installations gracefully.
  - **Disk Space Checks**: Prevents installation if disk space is critically low.
- **Task Management**:
  - **Queue System**: Operations run sequentially to ensure stability.
  - **Stop All**: Instantly halt all running processes safely.
  - **Uninstall**: Bulk uninstall support with cleanup.

---

## Tech Stack

- **Frontend**: React, TypeScript, Vite, CSS Modules (Custom Design System)
- **Backend/Main Process**: Electron, Node.js
- **State Management**: React Hooks + Context API + `electron-store` for persistence
- **Package Managers**:
  - macOS: `Homebrew` integration
  - Windows: `Winget` integration

---

## Getting Started

### Prerequisites

- **Node.js** (v18 or higher)
- **npm** or **yarn**
- **Git**

### Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/Balmukund-Maurya/OneClickInstall.git
    cd OneClickInstall
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    # or
    yarn install
    ```

### Development

Start the app in development mode with hot-reloading:

```bash
npm run dev
```

This will launch the Electron window and start the Vite dev server.

---

## Building for Production

To create a distributable executable/installer for your OS:

### macOS
Builds a `.dmg` or `.app` file:
```bash
npm run build:mac
```

### Windows
Builds a `.exe` installer:
```bash
npm run build:win
```

The output files will be located in the `dist/` directory.

---

## Project Structure

```
OneClickInstall/
├── src/
│   ├── main/               # Electron Main Process (Backend)
│   │   ├── agent.ts        # Orchestrator for installs
│   │   ├── executor.ts     # Command execution logic (spawn/exec)
│   │   ├── queue.ts        # Task queue management
│   │   └── index.ts        # Entry point
│   ├── preload/            # Preload scripts (IPC limits)
│   └── renderer/           # React Frontend (UI)
│       ├── src/
│       │   ├── components/ # Reusable UI components
│       │   ├── App.tsx     # Main application logic
│       │   ├── index.css   # Global styles & Theme variables
│       └── index.html
├── resources/              # Static assets (icons, images)
├── electron.vite.config.ts # Vite configuration
└── package.json            # Scripts and dependencies
```

---

## Contributing

Contributions are welcome! If you have ideas for new features, bug fixes, or catalog additions, feel free to open an issue or submit a pull request.

1.  Fork the repo
2.  Create your feature branch (`git checkout -b feature/amazing-feature`)
3.  Commit your changes (`git commit -m 'Add some amazing feature'`)
4.  Push to the branch (`git push origin feature/amazing-feature`)
5.  Open a Pull Request

---

## License

Distributed under the MIT License. See `LICENSE` for more information.

---

Built by **Balmukund Maurya**
