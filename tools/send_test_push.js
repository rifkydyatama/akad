#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
async function main(){
  const file = path.join(process.cwd(),'tmp','push-subscriptions.json');
  if(!fs.existsSync(file)){
    console.error('No subscriptions file found at', file);
    process.exit(1);
  }
  const raw = fs.readFileSync(file,'utf8');
  let data = {};
  try{ data = JSON.parse(raw||'{}'); }catch(e){ console.error('Invalid JSON in subscriptions file'); process.exit(1); }

  const all = Object.values(data).flat();
  if(all.length===0){ console.log('No subscriptions stored'); process.exit(0); }

  const webpush = require('web-push');
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

  if(!publicKey || !privateKey){
    console.warn('VAPID keys not found in env. Generating ephemeral keys for test. Note: ephemeral keys will not be valid for browser subscriptions that used a different public key.');
    const keys = webpush.generateVAPIDKeys();
    webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  } else {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  const payload = JSON.stringify({ title: 'Tes Push', body: 'Ini notifikasi test dari tools/send_test_push.js', data: { url: '/' } });

  for(const rec of all){
    const sub = rec.subscription || rec;
    try{
      await webpush.sendNotification(sub, payload);
      console.log('Sent OK to', sub.endpoint);
    }catch(e){
      console.error('Failed to send to', sub.endpoint, e && e.body ? e.body : e.message || e);
    }
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
