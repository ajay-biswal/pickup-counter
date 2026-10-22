import { ArrowRight, ShoppingBag, Trash2 } from 'lucide-react';
import type { Product } from '../../types/api';
import { formatPaise } from '../../lib/money';

interface CartPanelProps {
  products: Product[];
  quantities: Record<string, number>;
  submitting: boolean;
  onQuantityChange: (productId: string, quantity: number) => void;
  onCheckout: () => void;
}

export function CartPanel({
  products,
  quantities,
  submitting,
  onQuantityChange,
  onCheckout,
}: CartPanelProps) {
  const items = products.filter((product) => (quantities[product.id] ?? 0) > 0);
  const count = items.reduce((sum, product) => sum + (quantities[product.id] ?? 0), 0);
  const totalPaise = items.reduce(
    (sum, product) => sum + product.pricePaise * (quantities[product.id] ?? 0),
    0,
  );

  return (
    <aside className="cart-panel" aria-labelledby="cart-title">
      <div className="cart-panel__heading">
        <div className="cart-icon"><ShoppingBag size={19} aria-hidden="true" /></div>
        <div>
          <h2 id="cart-title">Your bag</h2>
          <p>{count === 1 ? '1 item selected' : `${count} items selected`}</p>
        </div>
        {count > 0 && <span className="cart-count">{count}</span>}
      </div>

      {items.length === 0 ? (
        <div className="cart-empty">
          <div className="cart-empty__icon"><ShoppingBag size={24} aria-hidden="true" /></div>
          <h3>A little room for snacks</h3>
          <p>Add something you love. Your picks will show up here.</p>
        </div>
      ) : (
        <div className="cart-items">
          {items.map((product) => {
            const quantity = quantities[product.id] ?? 0;
            return (
              <div className="cart-item" key={product.id}>
                <div className="cart-item__details">
                  <strong>{product.name}</strong>
                  <span>{quantity} × {formatPaise(product.pricePaise)}</span>
                </div>
                <div className="cart-item__actions">
                  <strong>{formatPaise(product.pricePaise * quantity)}</strong>
                  <button
                    type="button"
                    aria-label={`Remove all ${product.name}`}
                    className="icon-button cart-remove"
                    onClick={() => onQuantityChange(product.id, 0)}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="cart-summary">
        <div className="summary-row"><span>Subtotal</span><span>{formatPaise(totalPaise)}</span></div>
        <div className="summary-row summary-row--muted"><span>Taxes</span><span>Included</span></div>
        <div className="summary-total"><span>Total</span><strong>{formatPaise(totalPaise)}</strong></div>
        <button
          type="button"
          className="button button--primary checkout-button"
          disabled={count === 0 || submitting}
          onClick={onCheckout}
        >
          {submitting ? 'Reserving your snacks…' : 'Continue to payment'}
          {!submitting && <ArrowRight size={17} aria-hidden="true" />}
        </button>
        <p className="secure-note">Your stock is held for 2 minutes at checkout.</p>
      </div>
    </aside>
  );
}
