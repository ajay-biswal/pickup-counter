
import {  BadRequestException, Body, Controller, Headers, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service.js';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('create-order')
createRazorpayOrder(@Body() body: { orderId?: unknown }) {
  if (
    typeof body?.orderId !== 'string' ||
    !body.orderId.trim()
  ) {
    throw new BadRequestException('A valid orderId is required');
  }

  return this.paymentsService.createRazorpayOrder(body.orderId);
}

@Post('verify')
verifyRazorpayPayment(
  @Body()
  body: {
    orderId?: unknown;
    razorpay_order_id?: unknown;
    razorpay_payment_id?: unknown;
    razorpay_signature?: unknown;
  },
) {
  if (
    typeof body?.orderId !== 'string' ||
    typeof body.razorpay_order_id !== 'string' ||
    typeof body.razorpay_payment_id !== 'string' ||
    typeof body.razorpay_signature !== 'string'
  ) {
    throw new BadRequestException('Invalid payment verification data');
  }

  return this.paymentsService.verifyRazorpayPayment({
    orderId: body.orderId,
    razorpay_order_id: body.razorpay_order_id,
    razorpay_payment_id: body.razorpay_payment_id,
    razorpay_signature: body.razorpay_signature,
  });
}

  @Post('webhook')
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-signature') signature: string | undefined,
  ) {
    return this.paymentsService.handleWebhook(
      req.body,
      req.rawBody,
      signature,
    );
  }
}
