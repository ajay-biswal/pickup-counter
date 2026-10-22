export type OrderStatus =
  | 'HELD'
  | 'PAID'
  | 'EXPIRED'
  | 'NEEDS_REVIEW'
  | 'PICKED_UP';

export interface Product {
  id: string;
  name: string;
  pricePaise: number;
  availableUnits: number;
}

export interface OrderItem {
  id?: string;
  productId: string;
  quantity: number;
  pricePaise: number;
}

export interface OrderCreated {
  id: string;
  status: OrderStatus;
  totalPaise: number;
  expiresAt: string;
  expiresInSeconds: number;
  items: OrderItem[];
}

export interface OrderStatusResponse {
  id: string;
  status: OrderStatus;
  totalPaise: number;
  expiresAt: string;
}
