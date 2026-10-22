
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaymentsService } from '../../src/payments/payments.service.js';
import { prisma } from './test-database.js';

describe('Payment webhook (real PostgreSQL)', () => {
  const service = new PaymentsService(prisma as never);
  const productIds: string[] = [];
  const orderIds: string[] = [];

  beforeAll(async () => {
    if (!process.env.PAYMENT_WEBHOOK_SECRET) {
      throw new Error('PAYMENT_WEBHOOK_SECRET is missing from .env.test');
    }

    await prisma.$connect();
  });

  afterAll(async () => {
    if (orderIds.length > 0) {
      await prisma.paymentEvent.deleteMany({
        where: { orderId: { in: orderIds } },
      });

      await prisma.orderItem.deleteMany({
        where: { orderId: { in: orderIds } },
      });

      await prisma.order.deleteMany({
        where: { id: { in: orderIds } },
      });
    }

    if (productIds.length > 0) {
      await prisma.product.deleteMany({
        where: { id: { in: productIds } },
      });
    }

    await prisma.$disconnect();
  });

  async function createHeldOrder() {
    const product = await prisma.product.create({
      data: {
        name: `Payment Test ${Date.now()} ${Math.random()}`,
        pricePaise: 500,
        stock: 1,
      },
    });
    productIds.push(product.id);

    const order = await prisma.order.create({
      data: {
        status: 'HELD',
        totalPaise: 500,
        expiresAt: new Date(Date.now() + 120_000),
        items: {
          create: {
            productId: product.id,
            quantity: 1,
            pricePaise: 500,
          },
        },
      },
    });
    orderIds.push(order.id);

    return order;
  }

  async function sendSignedEvent(body: {
    eventId: string;
    orderId: string;
    amountPaise: number;
    status: 'captured' | 'FAILED';
  }) {
    const rawBody = Buffer.from(JSON.stringify(body));

    const signature = createHmac(
      'sha256',
      process.env.PAYMENT_WEBHOOK_SECRET!,
    )
      .update(rawBody)
      .digest('hex');

    return service.handleWebhook(body, rawBody, signature);
  }

  it('processes the same signed payment event only once', async () => {
    const order = await createHeldOrder();

    const body = {
      eventId: `evt_test_${Date.now()}`,
      orderId: order.id,
      amountPaise: 500,
      status: 'captured' as const,
    };

    const first = await sendSignedEvent(body);
    const second = await sendSignedEvent(body);

    expect(first.outcome).toBe('PAYMENT_ACCEPTED');
    expect(second.outcome).toBe('DUPLICATE_EVENT');

    const savedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(savedOrder.status).toBe('PAID');

    const eventCount = await prisma.paymentEvent.count({
      where: { eventId: body.eventId },
    });
    expect(eventCount).toBe(1);
  });

  it('flags a payment with an incorrect amount for review', async () => {
    const order = await createHeldOrder();

    const result = await sendSignedEvent({
      eventId: `evt_amount_mismatch_${Date.now()}`,
      orderId: order.id,
      amountPaise: 400,
      status: 'captured',
    });

    expect(result.outcome).toBe('AMOUNT_MISMATCH_REVIEW');

    const savedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });

    expect(savedOrder.status).toBe('NEEDS_REVIEW');
  });

  it('flags a payment received after the hold expires for review', async () => {
  const order = await createHeldOrder();

  await prisma.order.update({
    where: { id: order.id },
    data: { expiresAt: new Date(Date.now() - 1_000) },
  });

  const result = await sendSignedEvent({
    eventId: `evt_late_payment_${Date.now()}`,
    orderId: order.id,
    amountPaise: 500,
    status: 'captured',
  });

  expect(result.outcome).toBe('LATE_OR_INELIGIBLE_PAYMENT_REVIEW');

  const savedOrder = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
  });

  expect(savedOrder.status).toBe('NEEDS_REVIEW');
});
});
