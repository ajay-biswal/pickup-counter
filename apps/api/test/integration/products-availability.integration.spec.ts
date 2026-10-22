
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProductsService } from '../../src/products/products.service.js';
import { prisma } from './test-database.js';

describe('Product availability (real PostgreSQL)', () => {
  const service = new ProductsService(prisma as never);
  const productIds: string[] = [];
  const orderIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    if (orderIds.length > 0) {
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

  async function createProduct(name: string, stock = 10) {
    const product = await prisma.product.create({
      data: {
        name: `${name} ${Date.now()} ${Math.random()}`,
        pricePaise: 500,
        stock,
      },
    });

    productIds.push(product.id);
    return product;
  }

  async function createOrder(
    productId: string,
    status: 'HELD' | 'PAID' | 'EXPIRED' | 'PICKED_UP',
    quantity: number,
    expiresAt: Date,
  ) {
    const order = await prisma.order.create({
      data: {
        status,
        totalPaise: quantity * 500,
        expiresAt,
        items: {
          create: {
            productId,
            quantity,
            pricePaise: 500,
          },
        },
      },
    });

    orderIds.push(order.id);
    return order;
  }

  it('subtracts active HELD and PAID reservations from stock', async () => {
    const heldProduct = await createProduct('Active Hold', 10);
    await createOrder(
      heldProduct.id,
      'HELD',
      3,
      new Date(Date.now() + 120_000),
    );

    const paidProduct = await createProduct('Awaiting Pickup', 10);
    await createOrder(
      paidProduct.id,
      'PAID',
      2,
      new Date(Date.now() + 120_000),
    );

    const results = await service.findAll();
    const heldResult = results.find((p) => p.id === heldProduct.id);
    const paidResult = results.find((p) => p.id === paidProduct.id);

    expect(heldResult?.availableUnits).toBe(7);
    expect(paidResult?.availableUnits).toBe(8);
  });

  it('does not subtract expired holds or picked-up orders', async () => {
    const expiredProduct = await createProduct('Expired Hold', 10);
    await createOrder(
      expiredProduct.id,
      'HELD',
      3,
      new Date(Date.now() - 120_000),
    );

    const pickedUpProduct = await createProduct('Already Picked Up', 10);
    await createOrder(
      pickedUpProduct.id,
      'PICKED_UP',
      2,
      new Date(Date.now() + 120_000),
    );

    const results = await service.findAll();
    const expiredResult = results.find((p) => p.id === expiredProduct.id);
    const pickedUpResult = results.find((p) => p.id === pickedUpProduct.id);

    expect(expiredResult?.availableUnits).toBe(10);
    expect(pickedUpResult?.availableUnits).toBe(10);
  });
});
