import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildPushHTTPRequest } from 'npm:@pushforge/builder@2.0.5';

type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  severity: string;
  data: Record<string, unknown>;
  push_attempts: number;
};

type SubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const cronSecret = Deno.env.get('CRON_SECRET');
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';

  if (!supabaseUrl || !serviceRoleKey || !cronSecret || !vapidPublicKey || !vapidPrivateKey) {
    return json({ error: 'Secrets obrigatórios não configurados.' }, 500);
  }
  const receivedCronSecret = request.headers.get('x-cron-secret')?.trim() || '';
  const expectedCronSecret = cronSecret.trim();
  if (receivedCronSecret !== expectedCronSecret) {
    return json({
      error: 'Não autorizado.',
      diagnostic: {
        secretConfigured: Boolean(expectedCronSecret),
        headerReceived: Boolean(receivedCronSecret),
        expectedLength: expectedCronSecret.length,
        receivedLength: receivedCronSecret.length
      }
    }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: preferenceRows, error: preferencesError } = await supabase
    .from('notification_preferences')
    .select('user_id')
    .eq('in_app_enabled', true)
    .eq('push_enabled', true);
  if (preferencesError) return json({ error: preferencesError.message }, 500);

  const userIds = [...new Set((preferenceRows || []).map(row => row.user_id))];
  if (!userIds.length) return json({ ok: true, generated: 0, delivered: 0 });

  let generated = 0;
  for (const userId of userIds) {
    const { data, error } = await supabase.rpc('generate_financial_notifications_for_user', {
      p_user_id: userId
    });
    if (!error) generated += Number(data) || 0;
  }

  const { data: notificationRows, error: notificationsError } = await supabase
    .from('notifications')
    .select('id,user_id,type,title,body,severity,data,push_attempts')
    .in('user_id', userIds)
    .is('push_sent_at', null)
    .lt('push_attempts', 5)
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(100);
  if (notificationsError) return json({ error: notificationsError.message }, 500);

  const notifications = (notificationRows || []) as NotificationRow[];
  if (!notifications.length) return json({ ok: true, generated, delivered: 0 });

  const { data: subscriptionRows, error: subscriptionsError } = await supabase
    .from('push_subscriptions')
    .select('id,user_id,endpoint,p256dh,auth')
    .in('user_id', userIds)
    .eq('active', true);
  if (subscriptionsError) return json({ error: subscriptionsError.message }, 500);

  const subscriptionsByUser = new Map<string, SubscriptionRow[]>();
  for (const subscription of (subscriptionRows || []) as SubscriptionRow[]) {
    const current = subscriptionsByUser.get(subscription.user_id) || [];
    current.push(subscription);
    subscriptionsByUser.set(subscription.user_id, current);
  }

  let delivered = 0;
  let failed = 0;
  for (const notification of notifications) {
    const subscriptions = subscriptionsByUser.get(notification.user_id) || [];
    let deliveredToDevice = false;

    for (const subscription of subscriptions) {
      try {
        const pushRequest = await buildPushHTTPRequest({
          privateJWK: vapidPrivateKey,
          subscription: {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth }
          },
          message: {
            payload: {
              title: notification.title,
              body: notification.body,
              tag: notification.id,
              severity: notification.severity,
              type: notification.type,
              url: './#notifications',
              data: notification.data
            },
            adminContact: vapidSubject,
            options: {
              ttl: 3600,
              urgency: notification.severity === 'critical' ? 'high' : 'normal',
              topic: notification.type
            }
          }
        });
        const pushResponse = await fetch(pushRequest.endpoint, {
          method: 'POST',
          headers: pushRequest.headers,
          body: pushRequest.body
        });
        if (!pushResponse.ok) {
          const pushError = new Error(`Push service respondeu HTTP ${pushResponse.status}.`) as Error & {
            statusCode?: number;
          };
          pushError.statusCode = pushResponse.status;
          throw pushError;
        }
        deliveredToDevice = true;
      } catch (error) {
        failed += 1;
        const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
        const message = error instanceof Error ? error.message.slice(0, 500) : 'Falha no envio Web Push.';
        await supabase
          .from('push_subscriptions')
          .update({
            active: ![404, 410].includes(statusCode),
            last_error: message
          })
          .eq('id', subscription.id);
      }
    }

    await supabase
      .from('notifications')
      .update(deliveredToDevice
        ? { push_sent_at: new Date().toISOString(), push_attempts: notification.push_attempts + 1 }
        : { push_attempts: notification.push_attempts + 1 })
      .eq('id', notification.id);

    if (deliveredToDevice) delivered += 1;
  }

  return json({ ok: true, generated, delivered, failed });
});
