import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { ArrowDownWideNarrow, ArrowRight, Check, ChevronDown, CircleHelp, Clock3, Coffee, Leaf, Search, ShieldCheck, Sparkles, Utensils, Wifi, X } from 'lucide-react';
import { getProducts, createOrder } from './lib/api';
import { ProductCard } from './features/catalog/ProductCard';
import { CartPanel } from './features/cart/CartPanel';
import { PaymentPanel } from './features/checkout/PaymentPanel';
import type { OrderCreated, Product } from './types/api';
import './App.css';

type CartAction =
  | { type: 'set'; productId: string; quantity: number }
  | { type: 'clear' };

function cartReducer(state: Record<string, number>, action: CartAction): Record<string, number> {
  if (action.type === 'clear') return {};
  if (action.quantity <= 0) {
    const next = { ...state };
    delete next[action.productId];
    return next;
  }
  return { ...state, [action.productId]: action.quantity };
}

function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, dispatchCart] = useReducer(cartReducer, {});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [checkoutError, setCheckoutError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [activeOrder, setActiveOrder] = useState<OrderCreated | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All snacks');
  const [sortBy, setSortBy] = useState<'featured' | 'price-low' | 'price-high'>('featured');
  const [showHelp, setShowHelp] = useState(false);

  const loadProducts = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setLoadError('');
    try {
      const results = await getProducts();
      setProducts(results);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load snacks.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProducts();
    const refresh = window.setInterval(() => void loadProducts(false), 15000);
    return () => window.clearInterval(refresh);
  }, [loadProducts]);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    dispatchCart({ type: 'set', productId, quantity: Math.max(0, Math.min(quantity, product.availableUnits)) });
  }, [products]);

  const checkout = async () => {
    setCheckoutError('');
    setSubmitting(true);
    try {
      const order = await createOrder(
        Object.entries(cart)
          .filter(([, quantity]) => quantity > 0)
          .map(([productId, quantity]) => ({ productId, quantity })),
      );
      setActiveOrder(order);
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : 'We couldn’t reserve your items. Please try again.');
      await loadProducts(false);
    } finally {
      setSubmitting(false);
    }
  };

  const backToCatalog = () => {
    setActiveOrder(null);
    dispatchCart({ type: 'clear' });
    setCheckoutError('');
    void loadProducts();
  };

  const filteredProducts = useMemo(() => {
    const filtered = products.filter((product) => {
      const matchesSearch = product.name.toLowerCase().includes(search.trim().toLowerCase());
      const matchesCategory = category === 'All snacks'
        || (category === 'Sweet' && /chocolate|cookie/i.test(product.name))
        || (category === 'Drinks' && /juice|water/i.test(product.name))
        || (category === 'Savoury' && /chips/i.test(product.name));
      return matchesSearch && matchesCategory;
    });

    if (sortBy === 'price-low') return filtered.sort((a, b) => a.pricePaise - b.pricePaise);
    if (sortBy === 'price-high') return filtered.sort((a, b) => b.pricePaise - a.pricePaise);
    return filtered;
  }, [products, search, category, sortBy]);

  const itemCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);

  return (
    <div className="app-shell">
      <div className="announcement-bar"><Sparkles size={14} aria-hidden="true" /><span>A little break, made better.</span><span className="announcement-divider">·</span><span>Fresh picks at your fingertips</span></div>
      <header className="site-header">
        <a href="#home" className="brand-lockup" onClick={(event) => { event.preventDefault(); backToCatalog(); }}>
          <span className="brand-mark"><Coffee size={20} aria-hidden="true" /></span>
          <span className="brand-text"><strong>the little</strong><span>COUNTER</span></span>
        </a>
        <nav className="header-nav" aria-label="Main navigation"><a className="header-nav__active" href="#menu" onClick={(event) => { event.preventDefault(); backToCatalog(); }}>Shop snacks</a><button type="button" className="header-help" onClick={() => setShowHelp(true)}><CircleHelp size={16} aria-hidden="true" /> How it works</button></nav>
        <a className="header-cart" href="#cart" onClick={(event) => { event.preventDefault(); document.getElementById('cart-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}><span className="header-cart__icon"><Utensils size={17} aria-hidden="true" /></span><span>My bag</span><span className="header-cart__count">{itemCount}</span></a>
      </header>

      {activeOrder ? (
        <main className="checkout-page"><PaymentPanel order={activeOrder} onBackToCatalog={backToCatalog} /></main>
      ) : (
        <main id="home">
          <section className="hero-section">
            <div className="hero-content">
              <div className="hero-kicker"><span className="hero-kicker__dot" /> YOUR EVERYDAY PICK-ME-UP</div>
              <h1>Good things.<br /><em>Little moments.</em></h1>
              <p>That in-between moment deserves something lovely. Pick a snack, check out in a flash, and get back to your day.</p>
              <a className="hero-cta" href="#menu" onClick={(event) => { event.preventDefault(); document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' }); }}>Explore the counter <ArrowRight size={16} aria-hidden="true" /></a>
              <div className="hero-points"><span><Check size={14} /> Quick checkout</span><span><Check size={14} /> 2-minute hold</span><span><Check size={14} /> Easy pickup</span></div>
            </div>
            <div className="hero-art" aria-label="Illustration of a snack break" role="img">
              <div className="hero-art__orb hero-art__orb--one" /><div className="hero-art__orb hero-art__orb--two" />
              <div className="hero-art__sun" />
              <div className="hero-art__poster"><span>TAKE A</span><strong>SNACK<br />BREAK</strong><small>you deserve it.</small></div>
              <div className="hero-art__chips">🥔</div><div className="hero-art__orange">🍊</div><div className="hero-art__cookie">🍪</div>
              <div className="hero-art__cup">☕</div>
              <span className="hero-art__sparkle hero-art__sparkle--a">✳</span><span className="hero-art__sparkle hero-art__sparkle--b">✦</span><span className="hero-art__plant">✺</span>
            </div>
            <div className="hero-stamp"><span>GOOD</span><strong>MOOD</strong><span>FOOD</span></div>
          </section>

          <section className="trust-strip" aria-label="Counter benefits"><div><ShieldCheck size={17} /><span>Secure reservation</span></div><span className="trust-separator" /><div><ClockLabel /><span>Ready in a couple of minutes</span></div><span className="trust-separator" /><div><Leaf size={17} /><span>Simple, thoughtful picks</span></div></section>

          <section className="catalog-section" id="menu">
            <div className="section-heading"><div><p className="eyebrow">THE GOOD STUFF</p><h2>Pick your little <em>something.</em></h2><p className="section-description">A few favourites for your next small moment of joy.</p></div><div className="catalog-live"><span /> Live stock <small>refreshes automatically</small></div></div>
            {loadError && <div className="page-alert" role="alert"><Wifi size={17} /><div><strong>We can’t reach the counter.</strong><p>{loadError}</p></div><button className="button button--secondary" onClick={() => void loadProducts()}>Try again</button></div>}
            <div className="catalog-toolbar">
              <div className="search-field"><Search size={17} aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find your favourite…" aria-label="Search snacks" /><kbd>/</kbd></div>
              <div className="category-tabs" role="group" aria-label="Filter snacks">{['All snacks', 'Sweet', 'Savoury', 'Drinks'].map((item) => <button type="button" key={item} className={category === item ? 'category-tab category-tab--active' : 'category-tab'} onClick={() => setCategory(item)}>{item}</button>)}</div>
              <label className="sort-control"><ArrowDownWideNarrow size={15} aria-hidden="true" /><span className="sr-only">Sort products</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}><option value="featured">Featured</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select><ChevronDown size={13} aria-hidden="true" /></label>
            </div>

            {loading ? (
              <div className="product-grid" aria-label="Loading products">{Array.from({ length: 5 }, (_, index) => <div className="product-skeleton" key={index}><div /><span /><i /></div>)}</div>
            ) : filteredProducts.length > 0 ? (
              <div className="catalog-content"><div className="product-grid">{filteredProducts.map((product) => <ProductCard key={product.id} product={product} quantity={cart[product.id] ?? 0} onQuantityChange={updateQuantity} />)}</div><CartPanel products={products} quantities={cart} submitting={submitting} onQuantityChange={updateQuantity} onCheckout={() => void checkout()} /></div>
            ) : !loadError ? (
              <div className="empty-results"><Search size={25} /><h3>No snacks found</h3><p>Try a different search or category.</p><button type="button" className="button button--secondary" onClick={() => { setSearch(''); setCategory('All snacks'); }}>Clear filters</button></div>
            ) : null}

            {checkoutError && <div className="page-alert page-alert--error" role="alert"><X size={17} /><div><strong>We couldn’t reserve those items.</strong><p>{checkoutError}</p></div><button className="icon-button" onClick={() => setCheckoutError('')} aria-label="Dismiss error"><X size={16} /></button></div>}
            <div className="catalog-footnote"><ShieldCheck size={15} /><span>Availability can change quickly. Your items are only reserved after you continue to payment.</span></div>
          </section>
          <section className="bottom-note"><div className="bottom-note__icon"><Coffee size={20} /></div><div><p className="eyebrow">A SMALL PAUSE, A BETTER DAY</p><h2>Take the moment.<br /><em>We’ll handle the snacks.</em></h2></div><p>Pick what sounds good, reserve your items, and collect them when your payment is confirmed. It really is that simple.</p></section>
        </main>
      )}

      <footer className="site-footer"><a href="#home" className="footer-brand" onClick={(event) => { event.preventDefault(); backToCatalog(); }}><span className="brand-mark"><Coffee size={16} /></span><strong>the little COUNTER</strong></a><span>Made for your in-between moments.</span><span>Payment experience runs in demo mode.</span></footer>

      {showHelp && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowHelp(false); }}><section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><button type="button" className="icon-button help-close" onClick={() => setShowHelp(false)} aria-label="Close help"><X size={18} /></button><div className="help-modal__icon"><Sparkles size={23} /></div><p className="eyebrow">QUICK & EASY</p><h2 id="help-title">How the counter works</h2><div className="help-step"><span>01</span><div><strong>Pick your snacks</strong><p>Add your favourites to the bag. Live stock keeps availability up to date.</p></div></div><div className="help-step"><span>02</span><div><strong>Reserve & simulate payment</strong><p>Your order holds stock for 2 minutes. This assignment demo does not process real UPI payments.</p></div></div><div className="help-step"><span>03</span><div><strong>Collect when confirmed</strong><p>Once the payment webhook confirms your order, you can collect it at the locker.</p></div></div><button type="button" className="button button--primary help-done" onClick={() => setShowHelp(false)}>Got it</button></section></div>}
    </div>
  );
}

function ClockLabel() {
  return <span className="clock-label"><Clock3 size={16} aria-hidden="true" /></span>;
}

export default App;
