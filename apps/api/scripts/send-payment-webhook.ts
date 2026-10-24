import 'dotenv/config';
import { createHmac, randomUUID } from 'node:crypto';

const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';
const secret = process.env.PAYMENT_WEBHOOK_SECRET;

async function main() {
  const orderId = process.argv[2];

  if (!orderId) {
    console.error(
      'Usage: pnpm exec tsx scripts/send-payment-webhook.ts <ORDER_ID>',
    );
    process.exitCode = 1;
    return;
  }

  if (!secret) {
    throw new Error('PAYMENT_WEBHOOK_SECRET is missing from apps/api/.env');
  }

  // Fetch the order so the test uses its actual total.
  const orderResponse = await fetch(
    `${baseUrl}/orders/${encodeURIComponent(orderId)}`,
  );

  if (!orderResponse.ok) {
    throw new Error(
      `Could not fetch order (${orderResponse.status}): ${await orderResponse.text()}`,
    );
  }

  const order = (await orderResponse.json()) as {
    id: string;
    status: string;
    totalPaise: number;
  };

  if (order.status !== 'HELD') {
    throw new Error(
      `Order status is ${order.status}, not HELD. Create a fresh order to test payment.`,
    );
  }

  const payload = {
    eventId: randomUUID(),
    orderId: order.id,
    amountPaise: order.totalPaise,
    status: 'captured',
  };

  // Sign the exact JSON bytes that will be sent.
  const rawBody = JSON.stringify(payload);
  const signature = createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const response = await fetch(`${baseUrl}/payments/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature': signature,
    },
    body: rawBody,
  });

  const responseBody = await response.text();

  console.log(`HTTP ${response.status}`);
  console.log(responseBody);

  if (!response.ok) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
