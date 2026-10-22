import { Minus, Plus, PackageCheck } from 'lucide-react';
import type { Product } from '../../types/api';
import { formatPaise } from '../../lib/money';

interface ProductCardProps {
  product: Product;
  quantity: number;
  onQuantityChange: (productId: string, quantity: number) => void;
}

const productDetails: Record<string, { category: string; accent: string; icon: string }> = {
  'Potato Chips': { category: 'Crispy & savoury', accent: 'gold', icon: '🥔' },
  'Chocolate Bar': { category: 'Sweet treat', accent: 'cocoa', icon: '🍫' },
  Cookies: { category: 'Freshly baked feel', accent: 'peach', icon: '🍪' },
  'Orange Juice': { category: 'Bright & refreshing', accent: 'orange', icon: '🍊' },
  'Mineral Water': { category: 'Cool & simple', accent: 'blue', icon: '💧' },
};

export function ProductCard({ product, quantity, onQuantityChange }: ProductCardProps) {
  const detail = productDetails[product.name] ?? {
    category: 'Ready when you are',
    accent: 'sage',
    icon: '🥨',
  };
  const outOfStock = product.availableUnits <= 0;
  const maxReached = quantity >= product.availableUnits;

  return (
    <article className="product-card">
      <div className={`product-art product-art--${detail.accent}`}>
        <span className="product-emoji" aria-hidden="true">{detail.icon}</span>
        <span className={`stock-pill ${outOfStock ? 'stock-pill--empty' : ''}`}>
          {outOfStock ? 'Sold out' : `${product.availableUnits} available`}
        </span>
      </div>
      <div className="product-card__body">
        <div className="product-card__copy">
          <p className="eyebrow">{detail.category}</p>
          <h3>{product.name}</h3>
          <p className="product-description">
            {product.name === 'Potato Chips' && 'A crunchy little pick-me-up.'}
            {product.name === 'Chocolate Bar' && 'A smooth, cocoa-rich break.'}
            {product.name === 'Cookies' && 'A sweet bite for the road.'}
            {product.name === 'Orange Juice' && 'A fruity refresh, any time.'}
            {product.name === 'Mineral Water' && 'Stay refreshed and ready.'}
            {!Object.prototype.hasOwnProperty.call(productDetails, product.name) && 'A counter favourite, ready to go.'}
          </p>
        </div>
        <div className="product-card__footer">
          <strong className="product-price">{formatPaise(product.pricePaise)}</strong>
          <div className="quantity-control" aria-label={`Quantity for ${product.name}`}>
            <button
              type="button"
              className="quantity-button"
              aria-label={`Remove one ${product.name}`}
              disabled={quantity === 0}
              onClick={() => onQuantityChange(product.id, quantity - 1)}
            >
              <Minus size={15} aria-hidden="true" />
            </button>
            <span className="quantity-value" aria-live="polite">{quantity}</span>
            <button
              type="button"
              className="quantity-button quantity-button--add"
              aria-label={`Add one ${product.name}`}
              disabled={outOfStock || maxReached}
              onClick={() => onQuantityChange(product.id, quantity + 1)}
            >
              <Plus size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
        {outOfStock && (
          <p className="stock-note"><PackageCheck size={14} aria-hidden="true" /> Back in stock soon</p>
        )}
      </div>
    </article>
  );
}
