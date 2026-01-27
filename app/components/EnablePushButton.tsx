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
    <button
      onClick={handleEnable}
      disabled={status === 'requesting' || status === 'granted'}
      className={
        `px-3 py-2 bg-indigo-600 text-white rounded shadow hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold`
      }
      aria-pressed={status === 'granted'}
      aria-label="Enable notifications"
    >
      {status === 'idle' && 'Enable Push'}
      {status === 'requesting' && 'Requesting...'}
      {status === 'granted' && 'Push Enabled'}
      {status === 'denied' && 'Denied'}
      {status === 'error' && 'Error'}
    </button>
  );
}
