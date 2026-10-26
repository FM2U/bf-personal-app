// Minimal service worker so the app can be installed on a phone home screen.
// Pages always come from the network (data must be current); nothing private is cached.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
