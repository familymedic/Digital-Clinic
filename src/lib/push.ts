// Client-side push-notification helpers (2026-10-01). Pairs with
// public/sw.js's existing `push`/`notificationclick` handlers (built
// during the PWA work, 0049) and the new push_subscriptions table
// (0055). Nothing here ever sends a notification — it only manages
// *subscribing* this specific browser/device to receive one; the
// actual sending happens server-side (src/app/api/push/send), triggered
// by database events.

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// Web Push wants the VAPID public key as a BufferSource, not the
// base64url string env vars naturally hold. Built from a plain
// `ArrayBuffer` explicitly (rather than letting `new Uint8Array(length)`
// infer its backing buffer type) because PushManager.subscribe's TS
// types want an `ArrayBuffer`-backed view specifically, not the more
// general `ArrayBufferLike` a bare `Uint8Array` constructor produces
// under this project's TypeScript version -- a real type-check failure
// caught by running the production build, not a runtime issue.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function subscribeToPush(): Promise<PushSubscription> {
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    throw new Error("Push notifications aren't configured yet.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
}

export async function unsubscribeFromPush(): Promise<void> {
  const sub = await getExistingPushSubscription();
  if (sub) {
    await sub.unsubscribe();
  }
}

// Serializes a PushSubscription into the flat shape push_subscriptions
// stores (0055) — endpoint/p256dh/auth are what the row needs; the rest
// of the browser's PushSubscription object isn't useful to keep.
export function serializeSubscription(sub: PushSubscription): {
  endpoint: string;
  p256dh: string;
  auth_key: string;
} {
  const json = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh || "",
    auth_key: json.keys?.auth || "",
  };
}
