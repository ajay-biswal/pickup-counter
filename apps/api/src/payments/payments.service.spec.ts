import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentsService } from './payments.service.js';
import { PrismaService } from '../prisma.service.js';

describe('PaymentsService', () => {
  let service: PaymentsService;
  const paymentEventCreate = vi.fn();
  const orderFind = vi.fn();
  const orderUpdate = vi.fn();
  const queryRaw = vi.fn();
  const tx = {
    $queryRaw: queryRaw,
    paymentEvent: { create: paymentEventCreate },
    order: { findUniqueOrThrow: orderFind, update: orderUpdate },
  };
  const prismaMock = { $transaction: vi.fn() };
  const heldOrder = {
    id: 'internal-order-1',
    status: 'HELD',
    totalPaise: 500,
    expiresAt: new Date(Date.now() + 60_000),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get<PaymentsService>(PaymentsService);
    orderFind.mockResolvedValue(heldOrder);
    queryRaw.mockResolvedValue([{ id: heldOrder.id }]);
    paymentEventCreate.mockResolvedValue({});
    orderUpdate.mockResolvedValue({ ...heldOrder, status: 'PAID' });
    prismaMock.$transaction.mockImplementation((callback) => callback(tx));
  });

  afterEach(() => {
    delete process.env.PAYMENT_WEBHOOK_SECRET;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('simulates payment using the persisted total and marks the order paid', async () => {
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-secret';
    const result = await service.simulatePayment(heldOrder.id);

    expect(result).toMatchObject({ initiated: true, orderId: heldOrder.id });
    expect(paymentEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: heldOrder.id,
          amountPaise: 500,
          providerStatus: 'captured',
        }),
      }),
    );
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: heldOrder.id },
      data: { status: 'PAID' },
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(orderFind).toHaveBeenCalledTimes(1);
  });

  it('rejects safely when the server webhook secret is missing', async () => {
    await expect(service.simulatePayment(heldOrder.id)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('rejects a blank server webhook secret', async () => {
    process.env.PAYMENT_WEBHOOK_SECRET = '   ';
    await expect(service.simulatePayment(heldOrder.id)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('returns not found for a missing order', async () => {
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-secret';
    queryRaw.mockResolvedValueOnce([]);
    await expect(service.simulatePayment('missing-order')).rejects.toThrow(
      NotFoundException,
    );
    expect(paymentEventCreate).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'HELD', expiresAt: new Date(Date.now() - 1000) },
    { status: 'PAID', expiresAt: new Date(Date.now() + 60_000) },
  ])('rejects an expired or ineligible reservation', async (state) => {
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-secret';
    orderFind.mockResolvedValue({ ...heldOrder, ...state });
    await expect(service.simulatePayment(heldOrder.id)).rejects.toThrow(
      ConflictException,
    );
    expect(paymentEventCreate).not.toHaveBeenCalled();
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  describe('handleWebhook signature validation', () => {
    const body = {
      eventId: 'evt-invalid-signature',
      orderId: heldOrder.id,
      amountPaise: 500,
      status: 'captured',
    };
    const rawBody = Buffer.from(JSON.stringify(body));

    beforeEach(() => {
      process.env.PAYMENT_WEBHOOK_SECRET = 'test-secret';
    });

    it('rejects an invalid signature', async () => {
      await expect(
        service.handleWebhook(body, rawBody, '0'.repeat(64)),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a missing signature', async () => {
      await expect(
        service.handleWebhook(body, rawBody, undefined),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a malformed signature', async () => {
      await expect(
        service.handleWebhook(body, rawBody, 'not-a-valid-signature'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  it('preserves duplicate webhook event idempotency', async () => {
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-secret';
    const body = {
      eventId: 'evt-duplicate',
      orderId: heldOrder.id,
      amountPaise: 500,
      status: 'captured' as const,
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const { createHmac } = await import('node:crypto');
    const signature = createHmac('sha256', 'test-secret')
      .update(rawBody)
      .digest('hex');
    const { Prisma } = await import('../../generated/prisma/index.js');
    paymentEventCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.handleWebhook(body, rawBody, signature),
    ).resolves.toMatchObject({ outcome: 'DUPLICATE_EVENT' });
  });
});
