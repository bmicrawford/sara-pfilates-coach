/* Daily reminder display. The sentence is fixed. A push payload cannot change it. */
self.addEventListener('push', (event) => {
  const title = 'Sara'
  const body = 'Time for your 10-minute PfilAtes™ routine'
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const windowClient of windows) {
        if (windowClient.url && 'focus' in windowClient) return windowClient.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(target)
      return undefined
    }),
  )
})
