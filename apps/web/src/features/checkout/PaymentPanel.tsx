import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, Copy, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import type { OrderCreated, OrderStatus } from '../../types/api';
import { formatPaise } from '../../lib/money';

interface PaymentPanelProps {
  order: OrderCreated;
  onBackToCatalog: () => void;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function statusCopy(status: OrderStatus) {
  switch (status) {
    case 'PAID':
      return { title: 'Payment confirmed', description: 'You’re all set. Head to the pickup locker to collect your snacks.', className: 'status-card--success' };
    case 'EXPIRED':
      return { title: 'Your hold has expired', description: 'The reservation window ended before payment was confirmed. Your items are back on the shelf.', className: 'status-card--expired' };
    case 'NEEDS_REVIEW':
      return { title: 'Payment needs a quick review', description: 'We received a payment event that needs checking. Please don’t pay again; ask the counter attendant for help.', className: 'status-card--review' };
    default:
      return { title: 'Waiting for payment', description: 'Complete the simulated payment to confirm your order. This demo does not move real money.', className: '' };
  }
}

export function PaymentPanel({ order, onBackToCatalog }: PaymentPanelProps) {
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [secondsLeft, setSecondsLeft] = useState(Math.max(0, order.expiresInSeconds));
  const [pollError, setPollError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // performance.now is monotonic and avoids relying on the customer's wall clock.
    const receivedAt = performance.now();
    const durationMs = Math.max(0, order.expiresInSeconds) * 1000;
    const updateCountdown = () => {
      const elapsedMs = performance.now() - receivedAt;
      setSecondsLeft(Math.max(0, Math.ceil((durationMs - elapsedMs) / 1000)));
    };

    updateCountdown();
    const timer = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(timer);
  }, [order.id, order.expiresInSeconds]);

  useEffect(() => {
    let stopped = false;
    let timeout: number | undefined;
    let failures = 0;

    const poll = async () => {
      try {
        const { getOrderStatus } = await import('../../lib/api');
        const result = await getOrderStatus(order.id);
        if (stopped) return;
        failures = 0;
        setPollError('');
        setStatus(result.status);

        if (result.status === 'PAID' || result.status === 'EXPIRED' || result.status === 'NEEDS_REVIEW' || result.status === 'PICKED_UP') {
          return;
        }
      } catch (error) {
        if (stopped) return;
        failures += 1;
        setPollError(error instanceof Error ? error.message : 'Could not refresh order status.');
      }

      if (!stopped) {
        timeout = window.setTimeout(poll, Math.min(5000, 1500 * 2 ** Math.min(failures, 2)));
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [order.id]);

  const copyOrderId = async () => {
    try {
      await navigator.clipboard.writeText(order.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const terminal = status === 'PAID' || status === 'EXPIRED' || status === 'NEEDS_REVIEW' || status === 'PICKED_UP';
  const content = statusCopy(status === 'PICKED_UP' ? 'PAID' : status);
  const Icon = status === 'PAID' || status === 'PICKED_UP'
    ? CheckCircle2
    : status === 'NEEDS_REVIEW'
      ? AlertTriangle
      : status === 'EXPIRED'
        ? Clock3
        : LoaderCircle;

  return (
    <section className="payment-layout" aria-labelledby="payment-heading">
      <div className="payment-main">
        <button type="button" className="back-link" onClick={onBackToCatalog}>
          <ArrowLeft size={16} aria-hidden="true" /> Back to snacks
        </button>
        <div className="payment-intro">
          <div className="step-indicator"><span>02</span><span> / 02</span></div>
          <p className="eyebrow">SECURE CHECKOUT · DEMO MODE</p>
          <h1 id="payment-heading">One last step.</h1>
          <p className="page-subtitle">Confirm your payment and we’ll get your order ready.</p>
        </div>

        <div className={`status-card ${content.className}`}>
          <div className="status-card__icon"><Icon size={21} aria-hidden="true" /></div>
          <div className="status-card__text">
            <h2>{content.title}</h2>
            <p>{content.description}</p>
          </div>
          {!terminal && <span className="live-indicator"><span /> Live</span>}
        </div>

        {!terminal && (
          <>
            <div className="countdown-card">
              <div className="countdown-card__top">
                <div className="countdown-icon"><Clock3 size={19} aria-hidden="true" /></div>
                <div><strong>Your reservation is held</strong><p>Finish before the timer reaches zero.</p></div>
              </div>
              <div className={`countdown-value ${secondsLeft <= 15 ? 'countdown-value--urgent' : ''}`} aria-live="off">
                {formatTime(secondsLeft)}
              </div>
              <div className="countdown-progress" aria-hidden="true">
                <span style={{ width: `${Math.min(100, (secondsLeft / Math.max(1, order.expiresInSeconds)) * 100)}%` }} />
              </div>
              <p className="countdown-footnote">Time remaining on this reservation</p>
            </div>
            <div className="demo-payment-card">
              <div className="demo-payment-card__header">
                <div className="upi-mark">UPI</div>
                <div><h2>Simulated UPI payment</h2><p>No real money will be moved.</p></div>
                <span className="demo-badge">DEMO</span>
              </div>
              <div className="demo-payment-instructions">
                <div className="demo-payment-graphic" aria-hidden="true">
                  <div className="demo-payment-graphic__ring"><ShieldCheck size={38} /></div>
                  <span>DEMO ONLY</span>
                </div>
                <div><strong>Payment simulation is ready</strong><p>To simulate a captured payment, run the signed webhook script from your terminal. The signing secret stays on the server.</p></div>
              </div>
              <div className="payment-amount-row"><span>Amount due</span><strong>{formatPaise(order.totalPaise)}</strong></div>
            </div>
            {pollError && <div className="inline-alert"><AlertTriangle size={16} /><span>{pollError} We’ll keep retrying automatically.</span><button type="button" onClick={() => window.location.reload()} aria-label="Refresh checkout status"><RefreshCw size={15} /></button></div>}
          </>
        )}

        {terminal && (
          <div className="terminal-actions">
            {status === 'PAID' && (
              <div className="pickup-instructions">
                <CheckCircle2 size={19} aria-hidden="true" />
                <div><strong>Ready for collection</strong><p>Your order is confirmed. Use the locker claim process to collect it.</p></div>
              </div>
            )}
            <button type="button" className="button button--primary" onClick={onBackToCatalog}>Back to snack counter</button>
          </div>
        )}
      </div>

      <aside className="order-summary-card">
        <div className="order-summary-card__heading"><h2>Order summary</h2><span>#{order.id.slice(-6).toUpperCase()}</span></div>
        <div className="order-summary-card__body">
          {order.items.map((item) => (
            <div className="order-summary-item" key={`${item.productId}-${item.quantity}`}>
              <div className="order-summary-item__thumb"><ShoppingItemIcon /></div>
              <div className="order-summary-item__details"><strong>{item.quantity} × item</strong><span>Price locked at checkout</span></div>
              <strong>{formatPaise(item.pricePaise * item.quantity)}</strong>
            </div>
          ))}
        </div>
        <div className="order-summary-card__total"><span>Total to pay</span><strong>{formatPaise(order.totalPaise)}</strong></div>
        <div className="order-reference">
          <div><span>Order reference</span><strong>{order.id}</strong></div>
          <button type="button" className="icon-button" onClick={copyOrderId} aria-label="Copy order reference"><Copy size={15} /></button>
        </div>
        <p className="summary-assurance"><ShieldCheck size={15} aria-hidden="true" /> Your reservation is managed by the counter.</p>
        {copied && <p className="copy-feedback" role="status">Order reference copied</p>}
      </aside>
    </section>
  );
}

function ShoppingItemIcon() {
  return <span aria-hidden="true">▦</span>;
}
