
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { PickupService } from '../../src/pickup/pickup.service.js';
import { prisma } from './test-database.js';

describe('Pickup concurrency (real PostgreSQL)', () => {
  const service = new PickupService(prisma as never);
  let productId: string;
  let orderId: string;

  beforeAll(async () => {
    await prisma.$connect();

    const product = await prisma.product.create({
      data: {
        name: `Pickup Test ${Date.now()}`,
        pricePaise: 500,
        stock: 2,
      },
    });
    productId = product.id;

    const order = await prisma.order.create({
      data: {
        status: 'PAID',
        totalPaise: 500,
        expiresAt: new Date(Date.now() + 120_000),
        items: {
          create: {
            productId,
            quantity: 1,
            pricePaise: 500,
          },
        },
      },
    });
    orderId = order.id;
  });

  afterAll(async () => {
    if (orderId) {
      await prisma.orderItem.deleteMany({ where: { orderId } });
      await prisma.order.deleteMany({ where: { id: orderId } });
    }

    if (productId) {
      await prisma.product.deleteMany({ where: { id: productId } });
    }

    await prisma.$disconnect();
  });

  it('allows exactly one of two simultaneous pickup claims', async () => {
    const results = await Promise.allSettled([
      service.claim(orderId),
      service.claim(orderId),
    ]);

    const succeeded = results.filter(
      (result) => result.status === 'fulfilled',
    );
    const failed = results.filter(
      (result) => result.status === 'rejected',
    );

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const rejected = failed[0];
    if (rejected.status === 'rejected') {
      expect(rejected.reason).toBeInstanceOf(ConflictException);
      expect(rejected.reason.getStatus()).toBe(409);
    }

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(order.status).toBe('PICKED_UP');

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });
    expect(product.stock).toBe(1);
  });
});
