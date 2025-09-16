# WA-JS Usage Documentation

This document provides a comprehensive overview of how WA-JS (@wppconnect/wa-js) is integrated and used throughout the WhatsApp automation project.

## Table of Contents

1. [Project Overview](#project-overview)
2. [WA-JS Package Information](#wa-js-package-information)
3. [WA-JS Integration Architecture](#wa-js-integration-architecture)
4. [Core Usage Patterns](#core-usage-patterns)
5. [File-by-File Analysis](#file-by-file-analysis)
6. [Event System](#event-system)
7. [Configuration](#configuration)
8. [Status Operations](#status-operations)
9. [Authentication Methods](#authentication-methods)
10. [Best Practices](#best-practices)
11. [Troubleshooting](#troubleshooting)

---

## Project Overview

This WhatsApp automation project uses WA-JS (WPPConnect WhatsApp JavaScript library) to interact with WhatsApp Web through browser automation. The project provides multi-user session management with persistent browser contexts and comprehensive status management capabilities.

### Key Features
- Multi-user session management
- QR code and pairing code authentication
- WhatsApp status operations (create, view, delete)
- Persistent browser sessions
- REST API for automation control
- Real-time event handling

---

## WA-JS Package Information

### Dependencies
```json
{
  "@wppconnect/wa-js": "^3.18.4",
  "@wppconnect/wa-version": "^1.5.2104"
}
```

### Local WA-JS Bundle
- **Location**: `/wa-js/dist/wppconnect-wa.js`
- **Purpose**: Custom bundled version for injection into WhatsApp Web
- **Injection Method**: `page.addScriptTag()` with local file path

---

## WA-JS Integration Architecture

### 1. Script Injection Process

**Location**: `src/core/WhatsAppAutomation.js:88-118`

```javascript
// Pre-configure WPP before injection
await page.evaluate(() => {
    window.WPPConfig = {
        sendStatusToDevice: true,
        syncAllStatus: true,
    };
});

// Inject WA-JS bundle
const waJsPath = path.resolve("/home/ubuntu/wa-auto-v2/wa-js/dist/wppconnect-wa.js");
await page.addScriptTag({
    origin: "https://web.whatsapp.com/",
    path: waJsPath
});
```

### 2. Initialization Flow

1. **Browser Launch**: Playwright launches persistent Chromium context
2. **Page Setup**: Navigate to `https://web.whatsapp.com`
3. **WA-JS Injection**: Inject custom WA-JS bundle on page load
4. **Event Setup**: Configure authentication and status event listeners
5. **Ready Check**: Wait for `window.WPP.isReady` to be true

### 3. Security Considerations

- **CSP Bypass**: Uses Chrome DevTools Protocol to bypass Content Security Policy
- **Service Worker Removal**: Disables service workers for stability
- **Origin-based Injection**: Ensures WA-JS loads with correct origin

---

## Core Usage Patterns

### 1. WPP Object Access
All WA-JS functionality is accessed through the global `window.WPP` object:

```javascript
// Check if WA-JS is available
if (typeof window.WPP !== 'undefined' && window.WPP.isReady)

// Access connection methods
window.WPP.conn.isAuthenticated()
window.WPP.conn.isMainReady()

// Access status methods
window.WPP.status.sendTextStatus()
window.WPP.status.getMyStatus()
```

### 2. Authentication State Checking
```javascript
const authStatus = await page.evaluate(() => {
    return {
        isAuthenticated: window.WPP.conn.isAuthenticated(),
        isMainReady: window.WPP.conn.isMainReady(),
        isRegistered: window.WPP.conn.isRegistered(),
        isMultiDevice: window.WPP.conn.isMultiDevice()
    };
});
```

### 3. Phone Number Retrieval
```javascript
const phoneNumber = await page.evaluate(() => {
    if (window.WPP && window.WPP.conn && window.WPP.conn.me) {
        return window.WPP.conn.me.user; // Returns phone number
    }
    return null;
});
```

---

## File-by-File Analysis

### 1. `src/core/WhatsAppAutomation.js` (Primary Integration)

**Lines**: 1-743 (Full file uses WA-JS extensively)

**Key WA-JS Usage**:
- **Script Injection** (lines 88-118): Injects WA-JS bundle into WhatsApp Web
- **Event Setup** (lines 161-273): Configures WA-JS event listeners
- **Authentication** (lines 275-459): Uses WA-JS for login status and pairing codes
- **Configuration** (lines 671-680): Sets WPPConfig options

**Major Functions**:
```javascript
// WA-JS readiness check
await page.waitForFunction(
    () => typeof window.WPP !== 'undefined' && window.WPP.isReady,
    {}, { timeout: 30000 }
);

// Event listener setup
window.WPP.on('conn.authenticated', () => {
    window.onAuthenticated();
});

// Pairing code generation
const code = await window.WPP.conn.genLinkDeviceCodeForPhoneNumber(phone, true);
```

### 2. `src/core/StatusHandler.js` (Status Operations)

**Lines**: 1-1247 (Dedicated to WA-JS status operations)

**Key WA-JS Usage**:
- **Text Status** (lines 34-41): `window.WPP.status.sendTextStatus()`
- **Image Status** (lines 75-82): `window.WPP.status.sendImageStatus()`
- **Video Status** (lines 115-122): `window.WPP.status.sendVideoStatus()`
- **Status Retrieval** (lines 547-795): `window.WPP.status.getMyStatus()`
- **Status Deletion** (lines 275-533): Complex multi-method deletion approach

**Status Operations Pattern**:
```javascript
// Wait for WA-JS full readiness
await page.waitForFunction(() => {
    return typeof window.WPP !== 'undefined' && window.WPP.isFullReady;
}, { timeout: 15000 });

// Send status
const result = await page.evaluate(async ({ statusContent, statusOptions }) => {
    return await window.WPP.status.sendTextStatus(statusContent, statusOptions);
}, { statusContent: content, statusOptions: options });
```

### 3. `src/core/SessionManager.js` (Session Management)

**Lines**: Various throughout file

**Key WA-JS Usage**:
- **Auto-start Sessions** (lines 283-297): WA-JS initialization check
- **Authentication Status** (lines 299-301): `window.WPP.conn.isAuthenticated()`
- **Configuration** (lines 291-296): WPPConfig setup

### 4. `src/api/server.js` (API Server)

**Lines**: Various throughout file

**Key WA-JS Usage**:
- **Session Creation** (lines 191-209): WA-JS initialization waiting
- **Ready State Checks** (lines 382-384, 567-569, etc.): `window.WPP.isReady()`
- **Authentication Checks** (lines 856-859): Combined WA-JS status verification

### 5. `examples/get-phone-number.js` (Utility Examples)

**Lines**: 1-297 (Complete example file)

**Key WA-JS Usage**:
- **Phone Number Methods** (lines 11-46): Multiple approaches to get phone number
- **User Preferences** (lines 28-46): `window.WPP.whatsapp.UserPrefs` methods
- **Profile Information** (lines 89-110): `window.WPP.profile` methods

---

## Event System

### 1. Connection Events

**Location**: `src/core/WhatsAppAutomation.js:238-268`

```javascript
// Authentication successful
window.WPP.on('conn.authenticated', () => {
    window.onAuthenticated();
});

// QR code updated
window.WPP.on('conn.auth_code_change', (authCode) => {
    window.onAuthCodeChange(authCode);
});

// Authentication required
window.WPP.on('conn.require_auth', () => {
    window.onRequireAuth();
});

// User logged out
window.WPP.on('conn.logout', () => {
    window.onLogout();
});

// Interface ready
window.WPP.on('conn.main_ready', () => {
    window.onMainReady();
});

// Pairing code requested
window.WPP.on('conn.paring_code_requested', () => {
    window.onPairingCodeRequested();
});
```

### 2. Event Bridge Pattern

The project uses `page.exposeFunction()` to bridge WA-JS events to Node.js:

```javascript
// Expose Node.js function to browser
await page.exposeFunction('onAuthenticated', () => {
    console.log('User authenticated successfully via WA-JS');
    this.emit('authenticated', { sessionId: this.sessionId });
});

// Call from WA-JS event
window.WPP.on('conn.authenticated', () => {
    window.onAuthenticated(); // Calls Node.js function
});
```

---

## Configuration

### 1. WPPConfig Settings

**Location**: `src/core/WhatsAppAutomation.js:93-99`

```javascript
window.WPPConfig = {
    sendStatusToDevice: true,  // Enable status sync across devices
    syncAllStatus: true,       // Sync all status messages
};
```

### 2. Runtime Configuration

**Location**: `src/core/WhatsAppAutomation.js:672-679`

```javascript
await page.evaluate(() => {
    if (window.WPPConfig) {
        window.WPPConfig.sendStatusToDevice = true;
        window.WPPConfig.syncAllStatus = true;
    }
});
```

---

## Status Operations

### 1. Text Status

**Location**: `src/core/StatusHandler.js:34-41`

```javascript
const result = await page.evaluate(async ({ statusContent, statusOptions }) => {
    return await window.WPP.status.sendTextStatus(statusContent, statusOptions);
}, { statusContent: content, statusOptions: options });
```

### 2. Image Status

**Location**: `src/core/StatusHandler.js:115-122`

```javascript
const result = await page.evaluate(async ({ imageContent, imageOptions }) => {
    return await window.WPP.status.sendImageStatus(imageContent, imageOptions);
}, { imageContent: content, imageOptions: options });
```

### 3. Video Status

**Location**: `src/core/StatusHandler.js:75-82`

```javascript
const result = await page.evaluate(async ({ videoContent, videoOptions }) => {
    return await window.WPP.status.sendVideoStatus(videoContent, videoOptions);
}, { videoContent: content, videoOptions: options });
```

### 4. Status Retrieval

**Location**: `src/core/StatusHandler.js:588-590`

```javascript
const status = await window.WPP.status.getMyStatus();
```

### 5. Status Deletion (Advanced)

**Location**: `src/core/StatusHandler.js:276-533`

Multiple deletion methods attempted:
1. `window.WPP.chat.deleteMessage()` - Chat-based deletion
2. `window.WPP.status.remove()` - Direct status removal
3. Status expiration manipulation
4. Protocol message overwriting
5. StatusV3Store methods
6. Cmd operations

---

## Authentication Methods

### 1. QR Code Authentication

**Location**: `src/core/WhatsAppAutomation.js:534-558`

```javascript
// Get QR code
const authCode = await page.evaluate(() => {
    if (window.WPP && window.WPP.conn && window.WPP.conn.getAuthCode) {
        return window.WPP.conn.getAuthCode();
    }
    return null;
});

if (authCode && authCode.fullCode) {
    console.log('QR Code Available:', authCode.fullCode);
}
```

### 2. Pairing Code Authentication

**Location**: `src/core/WhatsAppAutomation.js:403-450`

```javascript
// Generate pairing code
const code = await page.evaluate(async (phone) => {
    return await window.WPP.conn.genLinkDeviceCodeForPhoneNumber(phone, true);
}, cleanPhone);
```

### 3. Authentication Status Checking

**Location**: `src/core/WhatsAppAutomation.js:282-295`

```javascript
const authStatus = await page.evaluate(() => {
    return {
        isAuthenticated: window.WPP.conn.isAuthenticated(),
        isMainReady: window.WPP.conn.isMainReady()
    };
});
```

---

## Best Practices

### 1. Always Check WA-JS Availability

```javascript
if (typeof window.WPP !== 'undefined' && window.WPP.isReady) {
    // Safe to use WA-JS methods
}
```

### 2. Wait for Full Readiness

```javascript
// For status operations, use isFullReady
await page.waitForFunction(() => {
    return typeof window.WPP !== 'undefined' && window.WPP.isFullReady;
});
```

### 3. Error Handling in Page Context

```javascript
const result = await page.evaluate(async () => {
    try {
        return await window.WPP.status.sendTextStatus(content);
    } catch (error) {
        throw new Error(`WA-JS operation failed: ${error.message}`);
    }
});
```

### 4. Event Listener Management

```javascript
// Check if event listeners are already setup
if (this.eventsSetup) {
    return true;
}

// Setup events and mark as configured
window.WPP.on('conn.authenticated', handler);
this.eventsSetup = true;
```

---

## Troubleshooting

### 1. WA-JS Not Loading

**Symptoms**: `window.WPP` is undefined
**Solutions**:
- Check if WA-JS bundle exists at `/wa-js/dist/wppconnect-wa.js`
- Verify CSP bypass is enabled
- Ensure page is loaded from `https://web.whatsapp.com`

### 2. Events Not Firing

**Symptoms**: Authentication events not triggered
**Solutions**:
- Verify event listeners are setup before authentication
- Check if `page.exposeFunction()` calls succeed
- Ensure WA-JS is fully initialized before setting up events

### 3. Status Operations Failing

**Symptoms**: Status methods return errors
**Solutions**:
- Wait for `window.WPP.isFullReady` before status operations
- Check if user is authenticated
- Verify status button is clicked before sending status

### 4. Authentication Issues

**Symptoms**: QR codes not generating or pairing codes failing
**Solutions**:
- Ensure user is not already authenticated
- Check if WhatsApp Web supports the authentication method
- Verify phone number format for pairing codes

---

## WA-JS Method Reference

### Connection Methods
- `window.WPP.conn.isAuthenticated()` - Check if user is logged in
- `window.WPP.conn.isMainReady()` - Check if interface is ready
- `window.WPP.conn.isRegistered()` - Check if user is registered
- `window.WPP.conn.isMultiDevice()` - Check if multi-device is enabled
- `window.WPP.conn.getAuthCode()` - Get current QR code
- `window.WPP.conn.genLinkDeviceCodeForPhoneNumber()` - Generate pairing code
- `window.WPP.conn.logout()` - Logout user

### Status Methods
- `window.WPP.status.sendTextStatus()` - Send text status
- `window.WPP.status.sendImageStatus()` - Send image status
- `window.WPP.status.sendVideoStatus()` - Send video status
- `window.WPP.status.getMyStatus()` - Get current user's status
- `window.WPP.status.remove()` - Remove status (if available)

### User Information
- `window.WPP.conn.me.user` - Current user's phone number
- `window.WPP.whatsapp.UserPrefs.getMaybeMePnUser()` - Get user Wid
- `window.WPP.profile.getMyStatus()` - Get profile status text
- `window.WPP.profile.getMyProfilePicThumb()` - Get profile picture

### Chat Operations
- `window.WPP.chat.getMessageById()` - Get message by ID
- `window.WPP.chat.deleteMessage()` - Delete message

---

## Conclusion

This project makes extensive use of WA-JS for WhatsApp Web automation, covering authentication, status management, and user information retrieval. The integration follows best practices for browser automation while providing a robust API for multi-user WhatsApp automation.

The key to successful WA-JS integration is:
1. Proper initialization timing
2. Comprehensive error handling
3. Event-driven architecture
4. State management across sessions
5. Graceful fallbacks for unsupported features