# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Running the Application
- **API Server Mode**: `node index.js --api` or `npm run api` - Starts REST API server on port 3000
- **API Server Dev Mode**: `npm run api:dev` - Starts API server with nodemon for auto-reload
- **Single User Mode**: `node index.js` or `npm start` - Legacy single-user automation mode
- **With QR Code Auth**: `node index.js --qr`
- **With Pairing Code Auth**: `node index.js --code --phone +1234567890`
- **Test Suite**: `npm test` or `node test-v2-complete.js` - Runs comprehensive test suite

### Orchestrator Commands
- `npm run orchestrator` - Run orchestrator example
- `npm run users:list` - List all users
- `npm run users:create` - Create new user
- `npm run login:qr` - Login with QR code
- `npm run login:code` - Login with pairing code
- `npm run stats` - View system statistics
- `npm run demo` - Run multi-user demo

## Project Architecture

### Directory Structure
```
wa-automation-v2/
├── index.js                 # Main entry point with exports
├── src/
│   ├── api/
│   │   └── server.js       # WhatsAppAPI class - Express REST server
│   ├── core/
│   │   ├── SessionManager.js    # Multi-user session management with DB persistence
│   │   ├── WhatsAppAutomation.js # Core automation logic with Playwright
│   │   └── StatusHandler.js     # WhatsApp Status operations
│   └── database/
│       └── JsonDB.js            # JSON-based database implementation
├── sessions/                # Persistent browser session data
├── data/                    # Database storage (whatsapp.db.json)
├── wa-js/                   # Custom WA-JS bundle
└── backups/                 # Session backup storage
```

### Core Components

1. **index.js** - Main entry point that:
   - Imports and re-exports all major classes for modular usage
   - Handles CLI arguments for different running modes
   - Can start API server or single-user mode based on flags

2. **SessionManager** (`src/core/SessionManager.js`):
   - Manages multiple WhatsApp sessions with database persistence
   - Uses JsonDB for storing session and user metadata
   - Collections: `sessions` and `users`
   - Auto-cleanup of inactive sessions (60 minutes default)
   - Session lifecycle: creating, authenticating, terminating

3. **WhatsAppAutomation** (`src/core/WhatsAppAutomation.js`):
   - Core browser automation using Playwright
   - Handles QR code and pairing code authentication
   - WA-JS injection and event management
   - CDP (Chrome DevTools Protocol) for CSP bypass
   - Persistent browser contexts in `./sessions/{sessionId}/`

4. **WhatsAppAPI** (`src/api/server.js`):
   - Express REST API server
   - Endpoints for session management and status operations
   - 100MB request limit for media uploads
   - CORS enabled for cross-origin requests
   - Auto-cleanup interval every 30 minutes

5. **JsonDB** (`src/database/JsonDB.js`):
   - JSON file-based database with MongoDB-like query syntax
   - Collections, documents, and query operations
   - Auto-save and prettify options
   - Used for persisting sessions and user data

### Authentication Methods

The system supports two authentication methods:
- **QR Code**: Generates QR code for mobile scanning (default)
- **Pairing Code**: Generates 8-digit code for phone number linking (requires `--phone` parameter)

### WA-JS Event System

Key events monitored:
- `conn.authenticated` - User successfully logged in
- `conn.auth_code_change` - QR/pairing code updated
- `conn.require_auth` - Authentication needed
- `conn.main_ready` - WhatsApp interface fully loaded
- `conn.logout` - User logged out

### Database Schema

**Sessions Collection**:
- `id`: Session UUID
- `userId`: Associated user ID
- `status`: pending|authenticated|failed|terminated
- `createdAt`: Creation timestamp
- `lastActivity`: Last activity timestamp
- `phoneNumber`: Optional phone number
- `authMethod`: qr|code

**Users Collection**:
- `userId`: Unique user identifier
- `createdAt`: Registration timestamp
- `lastActivity`: Last activity timestamp
- `totalSessions`: Session count

## Testing

Run comprehensive test suite with `node test-v2-complete.js` which tests:
- API server health checks
- Session creation and management
- Authentication flows
- Status operations
- Database persistence
- Architecture validation

## Environment Variables

Key environment variables from `.env`:
- `PORT` - API server port (default: 3000)
- `JWT_SECRET` - JWT token secret for authentication
- `MAX_CONCURRENT_SESSIONS` - Maximum parallel sessions
- `HEADLESS` - Run browser in headless mode (true/false)
- `SESSION_TIMEOUT` - Session inactivity timeout in minutes (default: 60)

## Important Implementation Notes

- Browser runs in non-headless mode by default for debugging visibility
- CDP is enabled to bypass Content Security Policy restrictions
- Service workers are disabled for stability
- Each session runs in an isolated browser context
- Sessions persist across restarts using Playwright's persistent context
- Database auto-saves on every write operation
- Media uploads support up to 100MB file size