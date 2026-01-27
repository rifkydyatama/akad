export function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export async function subscribeToPush(nim: string | null) {
  try {
    console.log('subscribeToPush: starting');
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('subscribeToPush: SW or PushManager not supported');
      return null;
    }
    console.log('subscribeToPush: registering SW (fixed)');
    const registration = await navigator.serviceWorker.register('/sw.fixed.js');
    console.log('subscribeToPush: waiting for SW ready');
    await navigator.serviceWorker.ready;
    console.log('subscribeToPush: requesting permission');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('subscribeToPush: permission not granted', permission);
      return null;
    }
    console.log('subscribeToPush: fetching VAPID');
    // `/api/push/vapid` returns JSON { publicKey }
    const vapidJson = await fetch('/api/push/vapid').then(r => r.json().catch(() => null));
    const vapid = (vapidJson && (vapidJson.publicKey || vapidJson.publicKey)) || (typeof vapidJson === 'string' ? vapidJson : null);
    if (!vapid) {
      console.warn('subscribeToPush: VAPID public key missing', vapidJson);
      return null;
    }
    console.log('subscribeToPush: subscribing to push', vapid);
    const sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapid) });
    console.log('subscribeToPush: posting to /api/push/subscribe', sub.endpoint);
    await fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nim, subscription: sub }) });
    console.log('subscribeToPush: success');
    return sub;
  } catch (err) {
    console.warn('subscribeToPush error', err);
    return null;
  }
}

export async function unsubscribePush(subscription: PushSubscription | null) {
  try {
    if (!subscription) return null;
    const endpoint = subscription.endpoint;
    await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint }) });
    await subscription.unsubscribe();
    return true;
  } catch (e) { return false; }
}
