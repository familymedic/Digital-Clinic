// Service worker for the Family Medic PWA (2026-09-30).
//
// Deliberately does NOT cache pages or API responses — this is a
// healthcare app; a patient or doctor seeing a stale cached version of
// a consultation, a queue, or a prescription because of aggressive
// offline caching would be a real safety problem, not just a UX
// annoyance. The only two jobs here are (1) letting the browser install
// the site as an app at all (a registered service worker is part of
// that contract) and (2) handling push notifications once they exist.
// Every network request just passes straight through to the network,
// same as if there were no service worker in the loop.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// No-op passthrough — present for install-criteria compatibility across
// browsers, not for caching. Every request just goes to the network.
self.addEventListener("fetch", () => {});

// Ready to receive a push the moment the subscription/sending side is
// built (not yet — see the delivery note for what's still needed:
// VAPID keys, a subscription table, and a sending mechanism). Until
// then this handler simply never fires, since nothing sends a push yet.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Family Medic", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Family Medic";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping a notification focuses an already-open tab if one exists,
// otherwise opens the relevant page in a new one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});