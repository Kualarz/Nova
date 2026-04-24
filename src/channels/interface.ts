/**
 * Channel interface — the contract every messaging channel must implement.
 * Phase 3 ships Telegram only. Phase 4+ can add WhatsApp, Discord, etc.
 */
export interface Channel {
  /** Send a message to Jimmy. */
  sendMessage(text: string): Promise<void>;
  /** Register a handler for incoming messages from Jimmy. */
  onMessage(handler: (text: string) => Promise<void>): void;
  /** Start listening (polling or webhook). */
  start(): Promise<void>;
  /** Stop listening cleanly. */
  stop(): Promise<void>;
}
