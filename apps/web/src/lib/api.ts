import type {
  OrderCreated,
  OrderStatusResponse,
  Product,
    RazorpayOrderResponse,
  RazorpayCheckoutResponse,
  PaymentVerificationResponse,
} from '../types/api';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error('Unable to reach the counter. Check your connection and try again.');
  }

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : null;

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object'
        ? ('message' in payload && typeof payload.message === 'string'
            ? payload.message
            : Array.isArray(payload.message)
              ? payload.message.join(', ')
              : undefined)
        : undefined;

    throw new Error(message ?? `Request failed (${response.status}). Please try again.`);
  }

  return payload as T;
}

export function getProducts(): Promise<Product[]> {
  return request<Product[]>('/products');
}

export function createOrder(items: Array<{ productId: string; quantity: number }>): Promise<OrderCreated> {
  return request<OrderCreated>('/orders', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}

export function getOrderStatus(orderId: string): Promise<OrderStatusResponse> {
  return request<OrderStatusResponse>(`/orders/${encodeURIComponent(orderId)}`);
}

export function createRazorpayOrder(
  orderId: string,
): Promise<RazorpayOrderResponse> {
  return request<RazorpayOrderResponse>('/payments/create-order', {
    method: 'POST',
    body: JSON.stringify({ orderId }),
  });
}

export function verifyRazorpayPayment(
  orderId: string,
  response: RazorpayCheckoutResponse,
): Promise<PaymentVerificationResponse> {
  return request<PaymentVerificationResponse>('/payments/verify', {
    method: 'POST',
    body: JSON.stringify({
      orderId,
      razorpay_order_id: response.razorpay_order_id,
      razorpay_payment_id: response.razorpay_payment_id,
      razorpay_signature: response.razorpay_signature,
    }),
  });
}
