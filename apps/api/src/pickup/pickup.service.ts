import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class PickupService {
  constructor(private readonly prisma: PrismaService) {}

  async claim(orderId: string) {
    if (!orderId?.trim()) {
      throw new NotFoundException('Order not found');
    }

    return this.prisma.$transaction(async (tx) => {
      // Lock the order so concurrent claims cannot both succeed.
      const orders = await tx.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM "Order"
        WHERE id = ${orderId}
        FOR UPDATE
      `;

      if (orders.length === 0) {
        throw new NotFoundException('Order not found');
      }

      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true },
      });

      if (order.status !== 'PAID') {
        throw new ConflictException(
          `Order cannot be picked up because its status is ${order.status}`,
        );
      }

      // Lock product rows in deterministic order to reduce deadlock risk.
      const productIds = [
        ...new Set(order.items.map((item) => item.productId)),
      ].sort();

      for (const productId of productIds) {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id
          FROM "Product"
          WHERE id = ${productId}
          FOR UPDATE
        `;

        if (rows.length === 0) {
          throw new ConflictException(
            'A product in this order no longer exists',
          );
        }
      }

      // Verify every stock change is valid before applying any changes.
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
      });

      const productById = new Map(
        products.map((product) => [product.id, product]),
      );

      for (const item of order.items) {
        const product = productById.get(item.productId);

        if (!product || product.stock < item.quantity) {
          throw new ConflictException(
            'Insufficient physical stock to complete pickup',
          );
        }
      }

      // All stock updates and the status change are part of this transaction.
      for (const item of order.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      const pickedUpOrder = await tx.order.update({
        where: { id: order.id },
        data: { status: 'PICKED_UP' },
        include: { items: true },
      });

      return {
        success: true,
        orderId: pickedUpOrder.id,
        status: pickedUpOrder.status,
        pickedUpAt: new Date().toISOString(),
      };
    });
  }
}