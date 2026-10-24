
import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import Razorpay from 'razorpay';
import { PaymentsService } from './payments.service.js';
import { PrismaService } from '../prisma.service.js';

// Create shared mocks before Vitest evaluates the mocked module.
const { razorpayMock } = vi.hoisted(() => ({
  razorpayMock: {
    payments: {
      fetch: vi.fn(),
    },
    orders: {
      create: vi.fn(),
    },
  },
}));

// The SDK is instantiated with `new Razorpay(...)` in the service.
// This mock behaves like a constructor and shares the methods above.
vi.mock('razorpay', () => ({
  default: class RazorpayMock {
    payments = razorpayMock.payments;
    orders = razorpayMock.orders;
  },
}));

describe('PaymentsService', () => {
  let service: PaymentsService;

  const prismaMock = {
    order: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  };

  const heldOrder = {
    id: 'internal-order-1',
    status: 'HELD',
    totalPaise: 500,
    expiresAt: new Date(Date.now() + 60_000),
    razorpayOrderId: 'order_gateway_1',
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule =
      await Test.createTestingModule({
        providers: [
          PaymentsService,
          {
            provide: PrismaService,
            useValue: prismaMock,
          },
        ],
      }).compile();

    service = module.get<PaymentsService>(PaymentsService);

    // Test-only credentials. Never use live credentials in tests.
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = 'test-secret';

    prismaMock.order.findUnique.mockResolvedValue(heldOrder);
    prismaMock.order.findUniqueOrThrow.mockResolvedValue(heldOrder);

    prismaMock.$queryRaw.mockResolvedValue([
      { id: heldOrder.id },
    ]);

    prismaMock.order.update.mockResolvedValue({
      ...heldOrder,
      status: 'PAID',
    });

    prismaMock.$transaction.mockImplementation(
      async (callback) =>
        callback({
          $queryRaw: prismaMock.$queryRaw,
          order: {
            findUniqueOrThrow:
              prismaMock.order.findUniqueOrThrow,
            update: prismaMock.order.update,
          },
        }),
    );

    razorpayMock.payments.fetch.mockResolvedValue({
      id: 'pay_test_1',
      order_id: 'order_gateway_1',
      amount: 500,
      currency: 'INR',
      status: 'captured',
    });
  });

  afterEach(() => {
    delete process.env.PAYMENT_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleWebhook', () => {
    it('should reject an invalid webhook signature', async () => {
      process.env.PAYMENT_WEBHOOK_SECRET = 'test-secret';

      const body = {
        eventId: 'evt-invalid-signature',
        orderId: 'order-test',
        amountPaise: 500,
        status: 'captured',
      };

      await expect(
        service.handleWebhook(
          body,
          Buffer.from(JSON.stringify(body)),
          '0'.repeat(64),
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject a missing webhook signature', async () => {
      process.env.PAYMENT_WEBHOOK_SECRET = 'test-secret';

      const body = {
        eventId: 'evt-missing-signature',
        orderId: 'order-test',
        amountPaise: 500,
        status: 'captured',
      };

      await expect(
        service.handleWebhook(
          body,
          Buffer.from(JSON.stringify(body)),
          undefined,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject a malformed webhook signature', async () => {
      process.env.PAYMENT_WEBHOOK_SECRET = 'test-secret';

      const body = {
        eventId: 'evt-malformed-signature',
        orderId: 'order-test',
        amountPaise: 500,
        status: 'captured',
      };

      await expect(
        service.handleWebhook(
          body,
          Buffer.from(JSON.stringify(body)),
          'not-a-valid-signature',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('verifyRazorpayPayment', () => {
    it('should reject an invalid Razorpay Checkout signature', async () => {
      await expect(
        service.verifyRazorpayPayment({
          orderId: heldOrder.id,
          razorpay_order_id: 'order_gateway_1',
          razorpay_payment_id: 'pay_test_1',
          razorpay_signature: '0'.repeat(64),
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(
        razorpayMock.payments.fetch,
      ).not.toHaveBeenCalled();
    });

    it('should reject a payment with the wrong amount', async () => {
      const signature = createHmac('sha256', 'test-secret')
        .update('order_gateway_1|pay_test_1')
        .digest('hex');

      razorpayMock.payments.fetch.mockResolvedValue({
        id: 'pay_test_1',
        order_id: 'order_gateway_1',
        amount: 999,
        currency: 'INR',
        status: 'captured',
      });

      await expect(
        service.verifyRazorpayPayment({
          orderId: heldOrder.id,
          razorpay_order_id: 'order_gateway_1',
          razorpay_payment_id: 'pay_test_1',
          razorpay_signature: signature,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject a payment that has not been captured', async () => {
      const signature = createHmac('sha256', 'test-secret')
        .update('order_gateway_1|pay_test_1')
        .digest('hex');

      razorpayMock.payments.fetch.mockResolvedValue({
        id: 'pay_test_1',
        order_id: 'order_gateway_1',
        amount: 500,
        currency: 'INR',
        status: 'authorized',
      });

      await expect(
        service.verifyRazorpayPayment({
          orderId: heldOrder.id,
          razorpay_order_id: 'order_gateway_1',
          razorpay_payment_id: 'pay_test_1',
          razorpay_signature: signature,
        }),
      ).rejects.toThrow(ConflictException);

      expect(prismaMock.order.update).not.toHaveBeenCalled();
    });

    it('should mark an eligible order PAID after verified capture', async () => {
      const signature = createHmac('sha256', 'test-secret')
        .update('order_gateway_1|pay_test_1')
        .digest('hex');

      const result = await service.verifyRazorpayPayment({
        orderId: heldOrder.id,
        razorpay_order_id: 'order_gateway_1',
        razorpay_payment_id: 'pay_test_1',
        razorpay_signature: signature,
      });

      expect(result).toEqual({
        verified: true,
        status: 'PAID',
        orderId: heldOrder.id,
      });

      expect(prismaMock.order.update).toHaveBeenCalledWith({
        where: { id: heldOrder.id },
        data: { status: 'PAID' },
      });
    });
  });
});
