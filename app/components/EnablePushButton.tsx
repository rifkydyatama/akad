"use client";
import React, { useState } from 'react';
import { subscribeToPush } from '../lib/notifications';

export default function EnablePushButton() {
  const [status, setStatus] = useState<'idle'|'requesting'|'granted'|'denied'|'error'>('idle');

  async function handleEnable() {
    try {
      setStatus('requesting');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setStatus('denied');
        return;
      }
      setStatus('requesting');
      // subscribeToPush in notifications.ts will register SW and post to /api/push/subscribe
      const sub = await subscribeToPush(null);
      if (sub) setStatus('granted'); else setStatus('error');
    } catch (e) { setStatus('error'); }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <button
        onClick={handleEnable}
        className="px-4 py-2 bg-indigo-600 text-white rounded shadow-lg hover:bg-indigo-700"
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
