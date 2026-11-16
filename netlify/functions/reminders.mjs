// Runs every minute on Netlify and sends the reminders that are due (works while the app is closed).
import { openStore } from '../lib/common.mjs';
import { deliverAll } from '../lib/push.mjs';

export default async () => {
  const sent = await deliverAll(openStore());
  return new Response(`sent ${sent}`);
};

export const config = { schedule: '* * * * *' };
