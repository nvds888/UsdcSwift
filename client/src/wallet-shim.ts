// This file adds polyfills needed for wallet libraries to work in the browser

// Create a global object for libraries that expect it
if (typeof window !== 'undefined' && !window.global) {
  (window as any).global = window;
}

// Add Buffer for libraries that depend on it
import { Buffer } from 'buffer';
if (typeof window !== 'undefined' && !window.Buffer) {
  (window as any).Buffer = Buffer;
}

// Add process.env for libraries that expect it
if (typeof window !== 'undefined' && !window.process) {
  (window as any).process = { env: {} };
}

export {}; // This makes the file a module