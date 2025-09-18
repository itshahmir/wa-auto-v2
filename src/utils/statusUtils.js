/**
 * Status utility functions for WhatsApp automation
 */

/**
 * Check if a JID is the status broadcast channel
 * @param {string} jid - The JID to check
 * @returns {boolean} True if the JID is status@broadcast
 */
const isJidStatusBroadcast = (jid) => jid === 'status@broadcast';

/**
 * Status broadcast JID constant
 */
const STATUS_BROADCAST_JID = 'status@broadcast';

module.exports = {
    isJidStatusBroadcast,
    STATUS_BROADCAST_JID
};

// TypeScript-style export for compatibility
if (typeof exports !== 'undefined') {
    exports.isJidStatusBroadcast = isJidStatusBroadcast;
    exports.STATUS_BROADCAST_JID = STATUS_BROADCAST_JID;
}