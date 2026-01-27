"use client";
import React, { useState } from 'react';
import { subscribeToPush } from '../lib/notifications';

export default function EnablePushButton() {
  const [status, setStatus] = useState<'idle'|'requesting'|'granted'|'denied'|'error'>('idle');
  async function handleEnable() {
    if (status === 'requesting' || status === 'granted') return;
    try {
      setStatus('requesting');
      // Ask permission (user gesture)
      const perm = await (typeof Notification !== 'undefined' ? Notification.requestPermission() : Promise.resolve('denied'));
      if (perm !== 'granted') {
        setStatus('denied');
        return;
      }
      // subscribeToPush will register SW and post to /api/push/subscribe
      const sub = await subscribeToPush(null);
      if (sub) setStatus('granted'); else setStatus('error');
    } catch (e) {
      setStatus('error');
    }
  }

  return (
    <div className="fixed right-4 top-4 sm:top-auto sm:bottom-4 z-50" style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}>
      <button
        onClick={handleEnable}
        disabled={status === 'requesting' || status === 'granted'}
        className={
          `px-4 py-2 bg-indigo-600 text-white rounded shadow-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed`
        }
        aria-pressed={status === 'granted'}
        aria-label="Enable notifications"
      >
        {status === 'idle' && 'Enable Notifications'}
        {status === 'requesting' && 'Requesting...'}
        {status === 'granted' && 'Notifications Enabled'}
        {status === 'denied' && 'Permission Denied'}
        {status === 'error' && 'Error'}
      </button>
    </div>
  );
}
