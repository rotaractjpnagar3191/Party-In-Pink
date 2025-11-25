// Service Worker for Party In Pink 5.0 PWA - Comprehensive Cache Fix
// Provides offline functionality and caching for better performance

const CACHE_NAME = 'party-in-pink-v20-html-network-first';
const STATIC_CACHE_NAME = 'party-in-pink-static-v20-html-network-first';
const CURRENT_VERSION = '5.6';

// Add timestamp to ensure cache busting
const CACHE_TIMESTAMP = Date.now();

// HTML pages - these should use network-first strategy to get updates
const HTML_PAGES = [
  '/',
  '/index.html',
  '/register.html',
  '/bulk.html', 
  '/donate.html',
  '/success.html'
];

// Static assets to cache (non-HTML)
const STATIC_ASSETS = [
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/assets/logos/4.0 Logos.png',
  '/assets/images/IMG_7757.webp'
];

// API endpoints that should not be cached
const DYNAMIC_APIS = [
  '/api/create-order',
  '/api/cf-webhook', 
  '/api/finalize-order',
  '/api/admin-stats',
  '/api/admin-export'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker v20...');
  
  event.waitUntil(
    Promise.all([
      // Cache HTML pages
      caches.open(CACHE_NAME).then((cache) => {
        console.log('[SW] Caching HTML pages');
        return cache.addAll(HTML_PAGES.map(url => new Request(url, { cache: 'reload' })));
      }),
      // Cache static assets
      caches.open(STATIC_CACHE_NAME).then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })));
      }),
      // Skip waiting to activate immediately
      self.skipWaiting()
    ])
  );
});

// Activate event - clean up old caches aggressively
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker v20...');
  
  event.waitUntil(
    Promise.all([
      // Clean up ALL old caches except current ones
      caches.keys().then((cacheNames) => {
        console.log('[SW] Found caches:', cacheNames);
        return Promise.all(
          cacheNames
            .filter((cacheName) => {
              // Keep only current cache names
              const isCurrent = cacheName === CACHE_NAME || cacheName === STATIC_CACHE_NAME;
              if (!isCurrent) {
                console.log('[SW] Deleting old cache:', cacheName);
              }
              return !isCurrent;
            })
            .map((cacheName) => caches.delete(cacheName))
        );
      }),
      // Claim all clients immediately
      self.clients.claim()
    ]).then(() => {
      console.log('[SW] Service worker v20 activated - all old caches cleared!');
      // Force reload all clients
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'CACHE_UPDATED', version: CURRENT_VERSION });
        });
      });
    })
  );
});

// Fetch event - handle network requests
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip external requests (like Cashfree SDK, KonfHub API)
  if (url.origin !== self.location.origin) {
    console.log('[SW] Skipping external request:', url.href);
    return;
  }

  // Skip dynamic API endpoints that should always be fresh
  if (DYNAMIC_APIS.some(api => url.pathname.startsWith(api))) {
    console.log('[SW] Skipping dynamic API:', url.pathname);
    return;
  }

  // Handle config API with network-first strategy (always try network first)
  if (url.pathname === '/api/config' || url.pathname.startsWith('/.netlify/functions/config')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone response before returning
          const responseClone = response.clone();
          
          // Cache successful responses
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          
          return response;
        })
        .catch(() => {
          // Fallback to cache if network fails
          return caches.match(request);
        })
    );
    return;
  }

  // Handle static assets with cache-first strategy
  if (STATIC_ASSETS.includes(url.pathname) || url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          console.log('[SW] Serving from cache:', url.pathname);
          return cachedResponse;
        }

        console.log('[SW] Fetching and caching:', url.pathname);
        return fetch(request).then((response) => {
          // Only cache successful responses
          if (!response.ok) {
            return response;
          }

          const responseClone = response.clone();
          caches.open(STATIC_CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });

          return response;
        });
      })
    );
    return;
  }

  // Handle HTML pages with STRICT network-first strategy (always try network first)
  const isHtmlPage = HTML_PAGES.includes(url.pathname) || 
                     request.destination === 'document' || 
                     url.pathname.endsWith('.html');
  
  if (isHtmlPage) {
    event.respondWith(
      // ALWAYS try network first for HTML
      fetch(request)
        .then((response) => {
          if (!response.ok) {
            // If network response is not ok, try cache
            return caches.match(request).then(cachedResponse => cachedResponse || response);
          }
          
          // Update cache with fresh version
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });

          console.log('[SW] Serving fresh HTML:', url.pathname);
          return response;
        })
        .catch(() => {
          // Network failed, fallback to cache
          console.log('[SW] Network failed, serving from cache:', url.pathname);
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Final fallback
            return caches.match('/index.html');
          });
        })
    );
    return;
  }

  // For all other requests, try network first, then cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only cache successful responses for non-critical resources
        if (response.ok && !url.pathname.startsWith('/api/')) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Try to serve from cache
        return caches.match(request);
      })
  );
});

// Handle background sync for when network comes back
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync triggered:', event.tag);
  
  if (event.tag === 'order-sync') {
    event.waitUntil(syncPendingOrders());
  }
});

// Handle push notifications (for future use)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || 'You have a new notification',
    icon: '/assets/logos/4.0 Logos.png',
    badge: '/assets/logos/4.0 Logos.png',
    tag: data.tag || 'general',
    data: data.data || {},
    actions: [
      {
        action: 'view',
        title: 'View Details'
      },
      {
        action: 'dismiss',
        title: 'Dismiss'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Party In Pink', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'view') {
    event.waitUntil(
      self.clients.openWindow(event.notification.data.url || '/')
    );
  }
});

// Sync pending orders when network is available (future enhancement)
async function syncPendingOrders() {
  try {
    console.log('[SW] Syncing pending orders...');
    // Implementation for offline order sync would go here
    // For now, just log that we would sync
    return Promise.resolve();
  } catch (error) {
    console.error('[SW] Failed to sync orders:', error);
    throw error;
  }
}

// Message handler for communication with main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Received skip waiting message');
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CACHE_URLS') {
    const urls = event.data.urls || [];
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.addAll(urls);
      })
    );
  }
});

console.log('[SW] Service worker script loaded');